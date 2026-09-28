/**
 * Apply the 2026-09-28 Treatwell price catalogue to a database — safely.
 *
 *   DRY RUN (default, read-only):
 *     CATALOG_DATABASE_URL=postgresql://… npx tsx prisma/price-catalog/apply-price-catalog.ts \
 *       --report docs/pricing/price-mapping-<env>.md
 *   APPLY (one transaction; refuses on any unknown row or changed value):
 *     … apply-price-catalog.ts --apply --confirm-host <db host> [--acknowledge-null-prices <n>] \
 *       --rollback-file <path.json>
 *   ROLLBACK (restores the service rows this tool changed; never deletes):
 *     … apply-price-catalog.ts --rollback <path.json> --confirm-host <db host>
 *
 * Guarantees:
 * - Rows are matched by their explicit option link (offeringId + hairLength +
 *   priceType) once linked; the exact legacy names in the catalogue are used
 *   only for the first, reviewed mapping. Re-running is a no-op.
 * - Every row in the database must be mapped, retired or listed as
 *   deliberately unchanged, or apply is refused (no guessing).
 * - Existing appointments, their prices, quotes and relations are never read
 *   for writing, changed or deleted. Nothing is deleted at all.
 * - Existing rows keep their public/bookable state; only retired unverified
 *   NHS options are hidden and closed to new bookings, and new rows start
 *   listed but NOT bookable (their durations are unconfirmed placeholders).
 * - Apply re-reads every row inside the transaction and aborts if any value
 *   differs from what the dry run planned against (optimistic check).
 */
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  CATALOG_ID,
  DELIBERATELY_UNCHANGED,
  OFFERINGS,
  PRICE_SOURCE,
  RETIRE_UNVERIFIED_NHS,
  SOURCE_NOTES,
  VERIFIED_AT,
  type CatalogOffering,
  type CatalogOption,
} from './treatwell-2026-09-28';
import { penceToDecimalString, toPence } from '../../src/app/services/pricing/money';

type Args = { apply: boolean; report?: string; confirmHost?: string; acknowledgeNullPrices?: number; rollbackFile?: string; rollback?: string; json?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === '--apply') args.apply = true;
    else if (flag === '--report') args.report = value();
    else if (flag === '--json') args.json = value();
    else if (flag === '--confirm-host') args.confirmHost = value();
    else if (flag === '--acknowledge-null-prices') args.acknowledgeNullPrices = Number(value());
    else if (flag === '--rollback-file') args.rollbackFile = value();
    else if (flag === '--rollback') args.rollback = value();
    else throw new Error(`Unknown argument ${flag}`);
  }
  return args;
}

const serviceSelect = {
  id: true, name: true, description: true, price: true, duration: true, category: true,
  requiresPatchTest: true, requiresConsultation: true, isPatchTest: true, isConsultation: true,
  offeringId: true, hairLength: true, priceType: true, priceVersion: true, vatDisplay: true, priceNature: true,
  priceNote: true, priceSource: true, priceVerifiedAt: true, isPublic: true, isBookable: true, durationConfirmed: true,
  surchargeBaseServiceId: true, surchargeAmount: true, updatedAt: true,
} satisfies Prisma.ServiceSelect;
type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>;

/** Fields this tool may write on a service row, with the value it will write. */
type ServiceWrite = {
  offeringKey: string;
  hairLength: string | null;
  priceType: string;
  pricePence: number;
  vatDisplay: 'EXCLUDED';
  priceNature: string;
  priceNote: string | null;
  surchargeBaseOption?: { hairLength: string; priceType: string };
  surchargePence?: number;
};

type PlanItem =
  | { action: 'UPDATE'; row: ServiceRow; write: ServiceWrite; option: CatalogOption; offering: CatalogOffering; changes: string[] }
  | { action: 'CREATE'; write: ServiceWrite; option: CatalogOption; offering: CatalogOffering; placeholderDuration: number; placeholderFrom: string }
  | { action: 'RETIRE'; row: ServiceRow; standardOffering: string; changes: string[] }
  | { action: 'UNCHANGED'; row: ServiceRow; reason: string }
  | { action: 'UNMAPPED'; row: ServiceRow };

type OfferingPlan = { key: string; action: 'CREATE' | 'UPDATE' | 'OK'; id?: string; changes: string[]; offering: CatalogOffering };

type Plan = {
  offerings: OfferingPlan[];
  items: PlanItem[];
  problems: string[];
  appointmentCounts: Map<string, number>;
  nullPrice: { total: number; byStatus: Record<string, number>; first: Date | null; last: Date | null; commissionAffected: number };
  host: string;
};

const optionKey = (offering: string, hairLength: string | null, priceType: string) => `${offering}|${hairLength ?? '-'}|${priceType}`;
const money = (pence: number) => `£${penceToDecimalString(pence)}`;

async function buildPlan(db: Prisma.TransactionClient, host: string): Promise<Plan> {
  const [services, offerings, counts, nullRows, employees] = await Promise.all([
    db.service.findMany({ select: serviceSelect, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    db.serviceOffering.findMany({ select: { id: true, key: true, name: true, category: true, displayOrder: true } }),
    db.appointment.groupBy({ by: ['serviceId'], _count: { _all: true } }),
    db.appointment.findMany({ where: { priceAtBooking: null }, select: { status: true, date: true, stylistId: true } }),
    db.employee.findMany({ where: { payType: { in: ['COMMISSION', 'HYBRID'] } }, select: { stylistId: true } }),
  ]);
  const problems: string[] = [];
  const offeringByKey = new Map(offerings.map((o) => [o.key, o]));
  const offeringKeyById = new Map(offerings.map((o) => [o.id, o.key]));
  const appointmentCounts = new Map(counts.map((c) => [c.serviceId, c._count._all]));
  const commissionStylists = new Set(employees.flatMap((e) => (e.stylistId ? [e.stylistId] : [])));

  const offeringPlans: OfferingPlan[] = OFFERINGS.map((offering) => {
    const existing = offeringByKey.get(offering.key);
    if (!existing) return { key: offering.key, action: 'CREATE', changes: ['new menu item'], offering };
    const changes = [
      ...(existing.category !== offering.category ? [`category ${existing.category} → ${offering.category}`] : []),
      ...(existing.displayOrder !== offering.displayOrder ? [`order ${existing.displayOrder} → ${offering.displayOrder}`] : []),
    ];
    return { key: offering.key, action: changes.length ? 'UPDATE' : 'OK', id: existing.id, changes, offering };
  });

  const claimed = new Set<string>();
  const items: PlanItem[] = [];
  const byLink = new Map<string, ServiceRow>();
  for (const row of services) {
    const key = row.offeringId ? offeringKeyById.get(row.offeringId) : undefined;
    if (key) byLink.set(optionKey(key, row.hairLength, row.priceType), row);
  }

  // Resolve every catalogue option to an existing row (link first, then the
  // reviewed legacy name) or a row to create.
  const resolved = new Map<string, { row?: ServiceRow; option: CatalogOption; offering: CatalogOffering }>();
  for (const offering of OFFERINGS) {
    for (const option of offering.options) {
      const key = optionKey(offering.key, option.hairLength, option.priceType);
      let row = byLink.get(key);
      if (!row) {
        const candidates = services.filter((s) => option.legacyNames.includes(s.name) && !claimed.has(s.id) && !s.offeringId);
        if (candidates.length > 1) problems.push(`Option ${key}: ${candidates.length} rows share a legacy name (${candidates.map((c) => c.id).join(', ')}) — resolve by hand.`);
        row = candidates.length === 1 ? candidates[0] : undefined;
      }
      if (row) claimed.add(row.id);
      if (!row && !option.create) problems.push(`Option ${key} has no row and no create rule.`);
      resolved.set(key, { row, option, offering });
    }
  }

  for (const [key, { row, option, offering }] of resolved) {
    const write: ServiceWrite = {
      offeringKey: offering.key,
      hairLength: option.hairLength,
      priceType: option.priceType,
      pricePence: option.pricePence,
      vatDisplay: 'EXCLUDED',
      priceNature: option.priceNature,
      priceNote: offering.priceNote ?? null,
      ...(option.surcharge ? { surchargeBaseOption: { hairLength: option.surcharge.baseHairLength, priceType: option.priceType }, surchargePence: option.surcharge.amountPence } : {}),
    };
    if (option.surcharge) {
      const base = resolved.get(optionKey(offering.key, option.surcharge.baseHairLength, option.priceType));
      const basePence = base?.option.pricePence;
      if (basePence === undefined || basePence + option.surcharge.amountPence !== option.pricePence) {
        problems.push(`Option ${key}: composite price does not equal its base option plus the surcharge.`);
      }
    }
    if (row) {
      const changes: string[] = [];
      const offeringId = offeringByKey.get(offering.key)?.id ?? null;
      if (row.offeringId !== offeringId || !offeringId) changes.push(`link → ${offering.key}`);
      if (row.hairLength !== option.hairLength) changes.push(`length ${row.hairLength ?? '—'} → ${option.hairLength ?? '—'}`);
      if (row.priceType !== option.priceType) changes.push(`type ${row.priceType} → ${option.priceType}`);
      if (toPence(row.price) !== option.pricePence) changes.push(`price ${money(toPence(row.price))} → ${money(option.pricePence)}`);
      if (row.vatDisplay !== 'EXCLUDED') changes.push(`VAT wording ${row.vatDisplay} → EXCLUDED`);
      if (row.priceNature !== option.priceNature) changes.push(`price nature ${row.priceNature} → ${option.priceNature}`);
      if ((row.priceNote ?? null) !== write.priceNote) changes.push('price note');
      if (row.priceSource !== PRICE_SOURCE) changes.push(`source → ${PRICE_SOURCE}`);
      if (option.surcharge && (row.surchargeAmount === null || toPence(row.surchargeAmount) !== option.surcharge.amountPence)) changes.push(`surcharge → ${money(option.surcharge.amountPence)}`);
      items.push({ action: 'UPDATE', row, write, option, offering, changes });
    } else if (option.create) {
      const from = option.create.placeholderDurationFrom;
      const sibling = resolved.get(optionKey(offering.key, from.hairLength, from.priceType))?.row;
      items.push({
        action: 'CREATE', write, option, offering,
        placeholderDuration: sibling?.duration ?? 60,
        placeholderFrom: sibling ? `${sibling.name} (${sibling.duration} min)` : 'no sibling found — 60 min default',
      });
    }
  }

  for (const row of services) {
    if (claimed.has(row.id)) continue;
    const retire = RETIRE_UNVERIFIED_NHS.find((r) => r.legacyName === row.name);
    if (retire) {
      const changes = [
        ...(row.isPublic ? ['hide from listings'] : []),
        ...(row.isBookable ? ['close to new bookings'] : []),
        ...(row.priceType !== 'NHS' ? ['type → NHS'] : []),
      ];
      items.push({ action: 'RETIRE', row, standardOffering: retire.standardOffering, changes });
      continue;
    }
    const unchanged = DELIBERATELY_UNCHANGED.find((u) => u.legacyName === row.name);
    if (unchanged) {
      items.push({ action: 'UNCHANGED', row, reason: unchanged.reason });
      continue;
    }
    // Rows the tool created on an earlier run are linked and were claimed above.
    items.push({ action: 'UNMAPPED', row });
    problems.push(`Service "${row.name}" (${row.id}) is not in the catalogue, the retire list or the unchanged list.`);
  }

  const byStatus: Record<string, number> = {};
  for (const row of nullRows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  const dates = nullRows.map((r) => r.date.getTime()).sort((a, b) => a - b);
  return {
    offerings: offeringPlans,
    items,
    problems,
    appointmentCounts,
    host,
    nullPrice: {
      total: nullRows.length,
      byStatus,
      first: dates.length ? new Date(dates[0]) : null,
      last: dates.length ? new Date(dates[dates.length - 1]) : null,
      commissionAffected: nullRows.filter((r) => r.status === 'COMPLETED' && commissionStylists.has(r.stylistId)).length,
    },
  };
}

function reportMarkdown(plan: Plan, mode: string): string {
  const lines: string[] = [];
  lines.push(`# Price catalogue mapping — ${CATALOG_ID}`, '');
  lines.push(`Generated ${new Date().toISOString()} (${mode}) against database host \`${plan.host}\`. Source: Treatwell menu read on ${VERIFIED_AT}; see prisma/price-catalog/treatwell-2026-09-28.ts.`, '');
  lines.push('Prices are the platform-listed amounts shown as “VAT excluded” (owner display policy; nothing added or back-calculated). `—` = no NHS option. Existing rows keep their current listed/bookable state unless retired.', '');
  lines.push('## Menu items (ServiceOffering)', '', '| Key | Name (English) | Category | Action |', '|---|---|---|---|');
  for (const o of plan.offerings) lines.push(`| ${o.key} | ${o.offering.name} | ${o.offering.category} | ${o.action}${o.changes.length ? ` (${o.changes.join('; ')})` : ''} |`);
  lines.push('', '## Options (Service rows)', '', '| Action | Existing ID | Current name | Menu item | Length | Type | Current price | New price | Duration | VAT wording (evidence) | Price nature | Listed / bookable after | Appointments | Changes |', '|---|---|---|---|---|---|---:|---:|---|---|---|---|---:|---|');
  const vat = (option: CatalogOption) => `VAT excluded (${option.vatEvidence === 'TREATWELL_LABEL' ? 'Treatwell item label' : 'owner policy; £37 add-on label unverified'})`;
  for (const item of plan.items) {
    if (item.action === 'UPDATE') {
      lines.push(`| ${item.changes.length ? 'UPDATE' : 'OK'} | ${item.row.id} | ${item.row.name} | ${item.offering.key} | ${item.option.hairLength ?? '—'} | ${item.option.priceType} | ${money(toPence(item.row.price))} | ${money(item.option.pricePence)}${item.option.surcharge ? ' (long + £37)' : ''} | ${item.row.duration} min${item.row.durationConfirmed ? '' : ' (unconfirmed)'} | ${vat(item.option)} | ${item.option.priceNature} | ${item.row.isPublic ? 'yes' : 'no'} / ${item.row.isBookable ? 'yes' : 'no'} | ${plan.appointmentCounts.get(item.row.id) ?? 0} | ${item.changes.join('; ') || '—'} |`);
    } else if (item.action === 'CREATE') {
      lines.push(`| CREATE | (new) | ${item.option.create!.name} | ${item.offering.key} | ${item.option.hairLength ?? '—'} | ${item.option.priceType} | — | ${money(item.option.pricePence)}${item.option.surcharge ? ' (long + £37)' : ''} | ${item.placeholderDuration} min placeholder from ${item.placeholderFrom}, unconfirmed | ${vat(item.option)} | ${item.option.priceNature} | yes / no | 0 | new option |`);
    } else if (item.action === 'RETIRE') {
      lines.push(`| RETIRE | ${item.row.id} | ${item.row.name} | ${item.standardOffering} | — | NHS | ${money(toPence(item.row.price))} | (kept, not offered) | ${item.row.duration} min | — | — | no / no | ${plan.appointmentCounts.get(item.row.id) ?? 0} | ${item.changes.join('; ') || 'already retired'} |`);
    } else if (item.action === 'UNCHANGED') {
      lines.push(`| UNCHANGED | ${item.row.id} | ${item.row.name} | — | — | ${item.row.priceType} | ${money(toPence(item.row.price))} | (unchanged) | ${item.row.duration} min | ${item.row.vatDisplay} | ${item.row.priceNature} | ${item.row.isPublic ? 'yes' : 'no'} / ${item.row.isBookable ? 'yes' : 'no'} | ${plan.appointmentCounts.get(item.row.id) ?? 0} | ${item.reason} |`);
    } else {
      lines.push(`| **UNMAPPED** | ${item.row.id} | ${item.row.name} | — | — | — | ${money(toPence(item.row.price))} | — | — | — | — | — | ${plan.appointmentCounts.get(item.row.id) ?? 0} | blocks apply |`);
    }
  }
  lines.push('', '## Historical prices', '');
  lines.push(`Appointments with no recorded price: **${plan.nullPrice.total}**${plan.nullPrice.total ? ` (${Object.entries(plan.nullPrice.byStatus).map(([s, n]) => `${s} ${n}`).join(', ')}; ${plan.nullPrice.first?.toISOString().slice(0, 10)} to ${plan.nullPrice.last?.toISOString().slice(0, 10)})` : ''}. Completed ones for commission-paid stylists: **${plan.nullPrice.commissionAffected}**.`, '');
  lines.push('These are shown as “price not recorded” (never today’s price or £0); payroll refuses to compute commission from them. This update does not touch any appointment.', '');
  lines.push('## Platform facts intentionally not turned into site prices', '', ...SOURCE_NOTES.map((note) => `- ${note}`), '');
  lines.push('## Problems', '', ...(plan.problems.length ? plan.problems.map((p) => `- ${p}`) : ['None — the plan can be applied.']), '');
  return lines.join('\n');
}

async function applyPlan(db: Prisma.TransactionClient, planned: Plan) {
  // Re-plan inside the transaction and require it to be identical in every
  // value that matters: nobody may have changed a row since the dry run.
  const current = await buildPlan(db, planned.host);
  const fingerprint = (plan: Plan) => JSON.stringify(plan.items.map((item) => ('row' in item
    ? [item.action, item.row.id, item.row.price.toString(), item.row.priceVersion, item.row.updatedAt.toISOString()]
    : [item.action, optionKey(item.write.offeringKey, item.write.hairLength, item.write.priceType)])));
  if (fingerprint(current) !== fingerprint(planned)) throw new Error('The database changed since the dry run. Run the dry run again and review it.');
  if (current.problems.length) throw new Error(`Refusing to apply: ${current.problems.length} problem(s). See the report.`);

  const rollback: { updated: Record<string, unknown>[]; created: string[]; createdOfferings: string[] } = { updated: [], created: [], createdOfferings: [] };
  const offeringIds = new Map<string, string>();
  for (const o of current.offerings) {
    if (o.action === 'CREATE') {
      const created = await db.serviceOffering.create({ data: { key: o.key, name: o.offering.name, category: o.offering.category, displayOrder: o.offering.displayOrder }, select: { id: true } });
      offeringIds.set(o.key, created.id);
      rollback.createdOfferings.push(created.id);
    } else {
      offeringIds.set(o.key, o.id!);
      if (o.action === 'UPDATE') await db.serviceOffering.update({ where: { id: o.id! }, data: { category: o.offering.category, displayOrder: o.offering.displayOrder } });
    }
  }
  const now = new Date(`${VERIFIED_AT}T12:00:00Z`);
  const idByOption = new Map<string, string>();
  const ordered = [...current.items].sort((a, b) => Number('write' in a && Boolean(a.write.surchargeBaseOption)) - Number('write' in b && Boolean(b.write.surchargeBaseOption)));
  for (const item of ordered) {
    if (item.action !== 'UPDATE' && item.action !== 'CREATE') continue;
    const key = optionKey(item.write.offeringKey, item.write.hairLength, item.write.priceType);
    const baseId = item.write.surchargeBaseOption ? idByOption.get(optionKey(item.write.offeringKey, item.write.surchargeBaseOption.hairLength, item.write.surchargeBaseOption.priceType)) : null;
    if (item.write.surchargeBaseOption && !baseId) throw new Error(`Base option for ${key} was not written first.`);
    const priceData = {
      offeringId: offeringIds.get(item.write.offeringKey)!,
      hairLength: item.write.hairLength,
      priceType: item.write.priceType,
      price: penceToDecimalString(item.write.pricePence),
      vatDisplay: item.write.vatDisplay,
      priceNature: item.write.priceNature,
      priceNote: item.write.priceNote,
      priceSource: PRICE_SOURCE,
      priceVerifiedAt: now,
      surchargeBaseServiceId: baseId ?? null,
      surchargeAmount: item.write.surchargePence !== undefined ? penceToDecimalString(item.write.surchargePence) : null,
    };
    if (item.action === 'UPDATE') {
      const row = item.row;
      rollback.updated.push({
        id: row.id, offeringId: row.offeringId, hairLength: row.hairLength, priceType: row.priceType, price: row.price.toString(),
        vatDisplay: row.vatDisplay, priceNature: row.priceNature, priceNote: row.priceNote, priceSource: row.priceSource,
        priceVerifiedAt: row.priceVerifiedAt?.toISOString() ?? null, surchargeBaseServiceId: row.surchargeBaseServiceId,
        surchargeAmount: row.surchargeAmount?.toString() ?? null, priceVersion: row.priceVersion,
        written: { price: priceData.price },
      });
      const priceChanged = toPence(row.price) !== item.write.pricePence;
      const changed = await db.service.updateMany({
        where: { id: row.id, priceVersion: row.priceVersion, updatedAt: row.updatedAt },
        data: { ...priceData, ...(priceChanged ? { priceVersion: { increment: 1 } } : {}) },
      });
      if (changed.count !== 1) throw new Error(`Service ${row.id} changed during apply.`);
      idByOption.set(key, row.id);
    } else {
      const created = await db.service.create({
        data: {
          ...priceData,
          name: item.option.create!.name,
          description: item.option.create!.description,
          category: item.offering.category,
          duration: item.placeholderDuration,
          durationConfirmed: false,
          isPublic: true,
          isBookable: false,
          requiresPatchTest: item.offering.flags.requiresPatchTest,
          requiresConsultation: item.offering.flags.requiresConsultation,
        },
        select: { id: true },
      });
      idByOption.set(key, created.id);
      rollback.created.push(created.id);
    }
  }
  for (const item of current.items) {
    if (item.action !== 'RETIRE') continue;
    rollback.updated.push({ id: item.row.id, isPublic: item.row.isPublic, isBookable: item.row.isBookable, priceType: item.row.priceType, offeringId: item.row.offeringId });
    const changed = await db.service.updateMany({
      where: { id: item.row.id, updatedAt: item.row.updatedAt },
      data: { isPublic: false, isBookable: false, priceType: 'NHS', offeringId: offeringIds.get(item.standardOffering) ?? null },
    });
    if (changed.count !== 1) throw new Error(`Service ${item.row.id} changed during apply.`);
  }
  await db.auditEvent.create({ data: { action: 'PRICE_CATALOG.APPLY', targetType: 'Service', metadataJson: JSON.stringify({ catalog: CATALOG_ID, updated: rollback.updated.length, created: rollback.created.length }) } });
  return rollback;
}

async function rollbackPlan(db: Prisma.TransactionClient, file: string) {
  const data = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8')) as { updated: Record<string, unknown>[]; created: string[] };
  // Restore previous field values. Appointments are never touched: bookings
  // made at the new prices keep their own frozen amounts and quotes.
  for (const row of data.updated) {
    const { id, written: _written, ...previous } = row as { id: string; written?: unknown } & Record<string, unknown>;
    void _written;
    const restore: Record<string, unknown> = { ...previous };
    if (typeof restore.priceVerifiedAt === 'string') restore.priceVerifiedAt = new Date(restore.priceVerifiedAt as string);
    // Bump the version so any open page confirming the new price is re-asked.
    if ('price' in restore) {
      delete restore.priceVersion;
      restore.priceVersion = { increment: 1 };
    }
    await db.service.update({ where: { id }, data: restore });
  }
  // New options are hidden and closed, never deleted (they may already have bookings).
  for (const id of data.created) await db.service.update({ where: { id }, data: { isPublic: false, isBookable: false } });
  await db.auditEvent.create({ data: { action: 'PRICE_CATALOG.ROLLBACK', targetType: 'Service', metadataJson: JSON.stringify({ catalog: CATALOG_ID, restored: data.updated.length, hidden: data.created.length }) } });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.CATALOG_DATABASE_URL;
  if (!url) throw new Error('Set CATALOG_DATABASE_URL to the database to inspect. (It is never read from .env files.)');
  const host = new URL(url.replace(/^file:/, 'file://local/')).hostname || 'local-file';
  const writing = args.apply || Boolean(args.rollback);
  if (writing && args.confirmHost !== host) throw new Error(`Refusing to write: pass --confirm-host ${host} to confirm the target.`);
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (args.rollback) {
      await db.$transaction((tx) => rollbackPlan(tx, args.rollback!), { isolationLevel: 'Serializable', timeout: 60_000 });
      console.log('Rollback applied.');
      return;
    }
    const isPostgres = url.startsWith('postgres');
    const plan = await db.$transaction(async (tx) => {
      // The dry run cannot write, even by accident.
      if (isPostgres) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return buildPlan(tx, host);
    });
    const report = reportMarkdown(plan, args.apply ? 'apply' : 'dry run');
    if (args.report) {
      mkdirSync(dirname(args.report), { recursive: true });
      writeFileSync(args.report, report);
    }
    const summary = plan.items.reduce<Record<string, number>>((acc, item) => {
      const label = item.action === 'UPDATE' && ('changes' in item) && item.changes.length === 0 ? 'OK' : item.action;
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});
    console.log(JSON.stringify({ host, summary, offerings: plan.offerings.map((o) => `${o.key}:${o.action}`), nullPrices: plan.nullPrice, problems: plan.problems }, null, 2));
    if (args.json) writeFileSync(args.json, JSON.stringify({ summary, problems: plan.problems, nullPrice: plan.nullPrice }, null, 2));
    if (!args.apply) {
      console.log(plan.problems.length ? 'DRY RUN: problems must be resolved before apply.' : 'DRY RUN: no problems. Review the report, then apply with --apply --confirm-host.');
      return;
    }
    if (plan.nullPrice.total > 0 && args.acknowledgeNullPrices !== plan.nullPrice.total) {
      throw new Error(`${plan.nullPrice.total} appointment(s) have no recorded price. Review them, then pass --acknowledge-null-prices ${plan.nullPrice.total}.`);
    }
    if (!args.rollbackFile) throw new Error('Pass --rollback-file <path.json> so the previous values are saved before applying.');
    const rollback = await db.$transaction((tx) => applyPlan(tx, plan), { isolationLevel: 'Serializable', timeout: 60_000 });
    mkdirSync(dirname(args.rollbackFile), { recursive: true });
    writeFileSync(args.rollbackFile, JSON.stringify(rollback, null, 2));
    console.log(`APPLIED. Rollback data written to ${args.rollbackFile}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
