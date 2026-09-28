/**
 * Publish the reviewed Traditional Chinese translations of the site's own
 * content (zh-HK.json) — as a first bilingual revision of each record.
 *
 *   DRY RUN (default, read-only):
 *     CONTENT_DATABASE_URL=… node --conditions=react-server --import tsx \
 *       prisma/content-translations/import-content-translations.ts --report docs/i18n/content-import-<env>.md
 *   APPLY:
 *     … --apply --confirm-host <db host>
 *
 * An entry is applied only when the record's CURRENT English equals the
 * English the translation was made from (`source`). If the English changed
 * since, the entry is reported as STALE and skipped — a translation of old
 * wording is never published next to new wording. Records with an open admin
 * draft are skipped too. Missing records and incomplete translations are
 * listed. Re-running is a no-op for entries already published.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { CONTENT_FIELDS, englishFieldsFromRow, type ContentEntityType } from '../../src/app/services/content/fields';
import { missingFields, sanitizeFields, type BilingualFields } from '../../src/app/services/content/review';
import { writePublished } from '../../src/app/services/content/drafts';

type Match =
  | { by: 'offeringKey'; key: string }
  | { by: 'catalogOption'; offering: string; hairLength: string | null; priceType: string }
  | { by: 'serviceName'; name: string }
  | { by: 'slug'; slug: string }
  | { by: 'faqKeyQuestion'; key: string; question: string }
  | { by: 'stylistName'; name: string }
  | { by: 'singleton' };

type Entry = { entityType: ContentEntityType; match: Match; source: Record<string, unknown>; fields: Record<string, unknown> };

type Outcome = { entry: Entry; status: 'WRITE' | 'UP_TO_DATE' | 'STALE' | 'MISSING' | 'INCOMPLETE' | 'DRAFT_OPEN'; id?: string; detail?: string };

const MODEL: Record<ContentEntityType, string> = {
  SERVICE: 'service', SERVICE_OFFERING: 'serviceOffering', CATEGORY_CONTENT: 'serviceCategoryContent', FAQ: 'faq',
  BLOG_POST: 'blogPost', STYLIST: 'stylist', OFFER: 'offer', SITE_SETTINGS: 'siteSettings',
};

async function findRecord(db: Prisma.TransactionClient, entry: Entry): Promise<Record<string, unknown> | null> {
  const select: Record<string, boolean> = { id: true };
  for (const spec of CONTENT_FIELDS[entry.entityType]) select[spec.column] = true;
  const delegate = (db as unknown as Record<string, { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> }>)[MODEL[entry.entityType]];
  const m = entry.match;
  switch (m.by) {
    case 'offeringKey': return delegate.findFirst({ where: { key: m.key }, select });
    case 'catalogOption': return delegate.findFirst({ where: { offering: { key: m.offering }, hairLength: m.hairLength, priceType: m.priceType }, select });
    case 'serviceName': return delegate.findFirst({ where: { name: m.name }, select });
    case 'slug': return delegate.findFirst({ where: { slug: m.slug }, select });
    case 'faqKeyQuestion': return delegate.findFirst({ where: { key: m.key, question: m.question }, select });
    case 'stylistName': return delegate.findFirst({ where: { name: m.name }, select });
    case 'singleton': return delegate.findFirst({ where: { id: 'singleton' }, select });
  }
}

const same = (type: ContentEntityType, a: unknown, b: unknown) => JSON.stringify(sanitizeFields(type, a)) === JSON.stringify(sanitizeFields(type, b));

async function plan(db: Prisma.TransactionClient, entries: Entry[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const entry of entries) {
    const record = await findRecord(db, entry);
    if (!record) {
      outcomes.push({ entry, status: 'MISSING' });
      continue;
    }
    const id = String(record.id);
    const english = englishFieldsFromRow(entry.entityType, record);
    if (!same(entry.entityType, english, entry.source)) {
      outcomes.push({ entry, status: 'STALE', id, detail: 'current English differs from the translated source' });
      continue;
    }
    const chinese = sanitizeFields(entry.entityType, entry.fields);
    const missing = missingFields(entry.entityType, chinese);
    if (missing.length) {
      outcomes.push({ entry, status: 'INCOMPLETE', id, detail: `missing ${missing.join(', ')}` });
      continue;
    }
    const [draft, existing] = await Promise.all([
      db.contentDraft.findUnique({ where: { entityType_entityId: { entityType: entry.entityType, entityId: id } }, select: { id: true } }),
      db.contentTranslation.findUnique({ where: { entityType_entityId_locale: { entityType: entry.entityType, entityId: id, locale: 'zh-HK' } }, select: { fieldsJson: true } }),
    ]);
    if (draft) {
      outcomes.push({ entry, status: 'DRAFT_OPEN', id, detail: 'an admin draft is open; publish or discard it first' });
      continue;
    }
    if (existing && same(entry.entityType, JSON.parse(existing.fieldsJson), chinese)) {
      outcomes.push({ entry, status: 'UP_TO_DATE', id });
      continue;
    }
    outcomes.push({ entry, status: 'WRITE', id });
  }
  return outcomes;
}

function describe(match: Match): string {
  switch (match.by) {
    case 'offeringKey': return `offering ${match.key}`;
    case 'catalogOption': return `${match.offering} / ${match.hairLength ?? '—'} / ${match.priceType}`;
    case 'serviceName': return `service “${match.name}”`;
    case 'slug': return `slug ${match.slug}`;
    case 'faqKeyQuestion': return `${match.key}: “${match.question.slice(0, 60)}”`;
    case 'stylistName': return `stylist ${match.name}`;
    case 'singleton': return 'site settings';
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const reportPath = argv.includes('--report') ? argv[argv.indexOf('--report') + 1] : undefined;
  const confirmHost = argv.includes('--confirm-host') ? argv[argv.indexOf('--confirm-host') + 1] : undefined;
  const url = process.env.CONTENT_DATABASE_URL;
  if (!url) throw new Error('Set CONTENT_DATABASE_URL to the database to inspect. (It is never read from .env files.)');
  const host = new URL(url.replace(/^file:/, 'file://local/')).hostname || 'local-file';
  if (apply && confirmHost !== host) throw new Error(`Refusing to write: pass --confirm-host ${host}.`);

  const file = JSON.parse(readFileSync(join(__dirname, 'zh-HK.json'), 'utf8')) as { entries: Entry[] };
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const outcomes = await db.$transaction(async (tx) => {
      if (!apply && url.startsWith('postgres')) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const planned = await plan(tx, file.entries);
      if (!apply) return planned;
      for (const outcome of planned) {
        if (outcome.status !== 'WRITE') continue;
        const current = await tx.contentTranslation.findMany({ where: { entityType: outcome.entry.entityType, entityId: outcome.id! }, select: { revision: true } });
        const revision = Math.max(0, ...current.map((row) => row.revision)) + 1;
        const record = await findRecord(tx, outcome.entry);
        const fields: BilingualFields = {
          'en-GB': englishFieldsFromRow(outcome.entry.entityType, record!),
          'zh-HK': sanitizeFields(outcome.entry.entityType, outcome.entry.fields),
        };
        await writePublished(tx, outcome.entry.entityType, outcome.id!, fields, revision, null);
      }
      await tx.auditEvent.create({ data: { action: 'CONTENT.IMPORT', targetType: 'ContentTranslation', metadataJson: JSON.stringify({ locale: 'zh-HK', written: planned.filter((o) => o.status === 'WRITE').length }) } });
      return planned;
    }, { timeout: 120_000 });

    const counts = outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }), {});
    console.log(JSON.stringify({ host, mode: apply ? 'apply' : 'dry run', counts }, null, 2));
    if (reportPath) {
      const lines = [
        `# zh-HK content import — ${apply ? 'apply' : 'dry run'}`, '',
        `Database host \`${host}\`, ${new Date().toISOString()}. Counts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
        '| Status | Type | Record | Id | Detail |', '|---|---|---|---|---|',
        ...outcomes.map((o) => `| ${o.status} | ${o.entry.entityType} | ${describe(o.entry.match).replace(/\|/g, '/')} | ${o.id ?? '—'} | ${o.detail ?? ''} |`),
        '',
        'STALE / MISSING / INCOMPLETE / DRAFT_OPEN entries still need a translation published through Admin (bilingual editor) or an updated zh-HK.json entry.',
      ];
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, lines.join('\n') + '\n');
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
