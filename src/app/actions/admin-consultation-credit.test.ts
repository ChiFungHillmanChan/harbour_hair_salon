import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

// Staff apply a paid consultation's fee to the treatment it was for (spec
// 2026-10-16-consultation-credit-pricing-ux-design.md §2.3): the dialog asks
// previewConsultationCredit what is available, and createAppointmentByAdmin /
// editAppointmentByAdmin look it up again inside their own Serializable
// transaction — the browser only ever says whether to apply it.

const SLOT = { dateStr: '2099-10-15', time: '11:00' }; // 10:00Z — BST
const TREATMENT_START = new Date('2099-10-15T10:00:00Z');
const CONSULTATION_DATE = new Date('2099-10-01T09:00:00Z');
const UPDATED_AT = new Date('2099-09-01T00:00:00Z');

type Row = Record<string, unknown>;

/** A Service row as quoteForNewBooking reads it (quotableServiceSelect). */
function serviceRow(id: string, name: string, price: number, duration: number, extra: Row = {}): Row {
  return {
    id, name, price, duration, offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1,
    vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED', durationConfirmed: true, surchargeBaseServiceId: null,
    surchargeAmount: null, priceSource: null, isPublic: true, isBookable: true, requiresPatchTest: false,
    requiresConsultation: false, isConsultation: false, isPatchTest: false, treatwellExternalId: null, ...extra,
  };
}

const SERVICES: Record<string, Row> = {
  colour: serviceRow('colour', 'Full Colour', 80, 120, { requiresConsultation: true }),
  // Consultation-required, but cheaper than the consultation: the credit is capped at its price.
  toner: serviceRow('toner', 'Toner', 10, 30, { requiresConsultation: true }),
  'blow-dry': serviceRow('blow-dry', 'Blow Dry', 40, 45),
  consult: serviceRow('consult', 'Colour Consultation', 15, 30, { isConsultation: true }),
};

const MEI = { id: 'user-9', email: 'mei@example.test', name: 'Mei', role: 'USER', phone: null, preferredLocale: 'en-GB' };
const ADA = { id: 'user-10', email: 'ada@example.test', name: 'Ada', role: 'USER', phone: null, preferredLocale: 'en-GB' };

/** A second, newer paid consultation of Mei's, nobody's credit yet. */
const NEWER_CONSULTATION: Row = {
  id: 'consult-2', userId: MEI.id, serviceId: 'consult', date: new Date('2099-10-08T09:00:00Z'), status: 'COMPLETED',
  lateCancelledAt: null, priceAtBooking: '15.00', consultationCreditFromId: null,
};

function fixture(options: {
  role?: string; treatment?: Row | null; extraRows?: Row[]; databaseDown?: boolean;
  /** The treatment's card deposit (status, amountPence); omitted: none. */
  deposit?: Row;
} = {}) {
  const rows: Row[] = [
    // Mei's paid colour consultation, two weeks before the treatment.
    { id: 'consult-1', userId: MEI.id, serviceId: 'consult', date: CONSULTATION_DATE, status: 'COMPLETED', lateCancelledAt: null, priceAtBooking: '15.00', consultationCreditFromId: null },
  ];
  rows.push(...(options.extraRows ?? []).map((row) => ({ ...row })));
  if (options.treatment !== null) {
    rows.push({
      id: 'appt-1', userId: MEI.id, stylistId: 'stylist-1', serviceId: 'colour', date: TREATMENT_START, status: 'CONFIRMED',
      durationAtBooking: 120, priceAtBooking: '80.00', quoteJson: null, notes: null, reminderSent: false,
      rescheduleRequestedDate: null, rescheduleRequestedAt: null, notificationVersion: 0, updatedAt: UPDATED_AT,
      treatwellBookingId: null, lateCancelledAt: null, consultationCreditFromId: 'consult-1', consultationCreditPence: 1500,
      ...options.treatment,
    });
  }
  const users: Row[] = [{ ...MEI }, { ...ADA }];
  const created: Row[] = [];
  const updates: Row[] = [];
  /** Which client ran each consultation-credit lookup, and whether a transaction was open at the time. */
  const creditLookups: { client: string; inTransaction: boolean }[] = [];
  let writes = 0;
  let transactionActive = false;

  /** The consultation-credit query (findConsultationCredit), answered from `rows` like the database would. */
  function creditCandidates(where: Row) {
    const range = where.date as { gte: Date; lte: Date };
    const statuses = (where.status as { in: string[] }).in;
    return rows
      .filter((row) => row.userId === where.userId && statuses.includes(row.status as string))
      .filter((row) => (row.date as Date) >= range.gte && (row.date as Date) <= range.lte)
      .filter((row) => SERVICES[row.serviceId as string].isConsultation || SERVICES[row.serviceId as string].isPatchTest)
      .map((row) => ({
        id: row.id, date: row.date, status: row.status, lateCancelledAt: row.lateCancelledAt, priceAtBooking: row.priceAtBooking,
        service: { isConsultation: SERVICES[row.serviceId as string].isConsultation, isPatchTest: SERVICES[row.serviceId as string].isPatchTest },
        consultationCreditUsedBy: rows.filter((use) => use.consultationCreditFromId === row.id).map((use) => ({ id: use.id, status: use.status })),
      }));
  }

  function client(label: string) {
    return {
      appointment: {
        findMany: async ({ where }: { where: Row }) => {
          const service = where?.service as Row | undefined;
          if (service && 'OR' in service) {
            if (options.databaseDown) throw new Error('Can\'t reach database server');
            creditLookups.push({ client: label, inTransaction: transactionActive });
            return structuredClone(creditCandidates(where));
          }
          return []; // patch-test history and the clash scan: an empty diary
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
          const row = rows.find((candidate) => candidate.id === where.id);
          if (!row) return null;
          const service = SERVICES[row.serviceId as string];
          return structuredClone({
            ...row,
            user: { email: MEI.email, name: MEI.name, phone: null },
            stylist: { name: 'Ivan', treatwellExternalId: null },
            service: { ...service },
            paymentAttempt: row.id === 'appt-1' ? options.deposit ?? null : null,
          });
        },
        create: async ({ data }: { data: Row }) => {
          writes++;
          created.push(data);
          const row = { ...data, id: `new-${created.length}`, notificationVersion: 0 };
          rows.push(row);
          return { ...row, user: { email: MEI.email, name: MEI.name, phone: null }, stylist: { name: 'Ivan' }, service: SERVICES[data.serviceId as string] };
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          writes++;
          const row = rows.find((candidate) => candidate.id === where.id);
          if (!row || (row.updatedAt as Date).getTime() !== (where.updatedAt as Date).getTime()) return { count: 0 };
          updates.push(data);
          for (const [key, value] of Object.entries(data)) {
            row[key] = value && typeof value === 'object' && 'increment' in (value as Row) ? Number(row[key]) + Number((value as Row).increment) : value;
          }
          return { count: 1 };
        },
      },
      service: { findUnique: async ({ where }: { where: { id: string } }) => SERVICES[where.id] ?? null },
      stylist: { findUnique: async () => ({ id: 'stylist-1', isActive: true, treatwellExternalId: null }) },
      user: {
        findUnique: async ({ where }: { where: Row }) =>
          users.find((row) => (where.id && row.id === where.id) || (where.email && row.email === where.email)) ?? null,
        create: async ({ data }: { data: Row }) => {
          writes++;
          const row = { ...data, id: `user-${users.length + 1}` };
          users.push(row);
          return row;
        },
        update: async () => { writes++; return users[0]; },
      },
      availability: { findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }) },
      externalBusyBlock: { findMany: async () => [] },
    };
  }

  const tx = client('tx');
  // Serializable isolation guarantees the outcome of SOME serial order (a
  // conflicting transaction is aborted and retried); this fake runs every
  // transaction one after the other, which is that outcome.
  let previous: Promise<unknown> = Promise.resolve();
  const db = {
    ...client('prisma'),
    $transaction: (fn: (client: unknown) => Promise<unknown>) => {
      const run = previous.then(async () => {
        transactionActive = true;
        try { return await fn(tx); } finally { transactionActive = false; }
      });
      previous = run.catch(() => undefined);
      return run;
    },
  };

  const queue = {
    enqueueAppointmentNotification: async () => ({ id: 'event-1' }),
    dispatchAppointmentNotifications: async () => undefined,
  };
  const session = { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) };

  const bookingService = loadServerModule<typeof import('../services/booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    './offers-service': { getActiveGlobalOffer: async () => null },
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({ phone: '', bookingEnabled: true }) },
    './notification-outbox-service': queue,
  });

  const schedule = loadServerModule<typeof import('./admin-schedule')>('src/app/actions/admin-schedule.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/session': session,
    '@/app/services/booking-service': bookingService,
    '@/app/services/notification-outbox-service': queue,
    '@/app/services/treatwell-api': {
      getTreatwellApiConfiguration: () => ({ enabled: false, configured: false }),
      changedTreatwellSyncStatus: () => 'NOT_REQUIRED',
      initialTreatwellSyncStatus: () => 'NOT_REQUIRED',
    },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => undefined },
    'next/server': { after: (callback: () => unknown) => callback() },
  });

  const preview = loadServerModule<typeof import('./admin-consultation-credit')>('src/app/actions/admin-consultation-credit.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/session': session,
  });

  return { schedule, preview, rows, created, updates, creditLookups, writes: () => writes };
}

const colourFor = (customer: Row, overrides: Row = {}) => ({
  customer: { kind: 'existing' as const, userId: customer.id as string },
  serviceId: 'colour',
  stylistId: 'stylist-1',
  ...SLOT,
  durationMin: 120,
  status: 'CONFIRMED' as const,
  notes: '',
  notifyCustomer: false,
  overrideClashes: true,
  expectedQuote: { serviceId: 'colour', priceVersion: 1, amountPence: 8000 },
  applyConsultationCredit: true,
  ...overrides,
});

const creditOf = (row: Row) => ({ from: row.consultationCreditFromId, pence: row.consultationCreditPence });

test('a ticked new booking records the credit the server looked up itself, inside the booking transaction', async () => {
  const { schedule, created, creditLookups } = fixture({ treatment: null });

  // A browser that tries to name its own amount or consultation is ignored: the schema has no such fields.
  const result = await schedule.createAppointmentByAdmin({ ...colourFor(MEI), consultationCreditPence: 8000, consultationCreditFromId: 'other' } as never);

  assert.equal(result.success, true);
  assert.deepEqual(creditOf(created[0]), { from: 'consult-1', pence: 1500 });
  // The treatment's own price is untouched: the credit is a separate deduction.
  assert.equal(created[0].priceAtBooking, '80.00');
  assert.equal(JSON.parse(created[0].quoteJson as string).amountPence, 8000);
  assert.deepEqual(creditLookups, [{ client: 'tx', inTransaction: true }]);
});

test('the credit is capped at the treatment\'s price', async () => {
  const { schedule, created } = fixture({ treatment: null });

  await schedule.createAppointmentByAdmin(colourFor(MEI, { serviceId: 'toner', durationMin: 30, expectedQuote: { serviceId: 'toner', priceVersion: 1, amountPence: 1000 } }));

  assert.deepEqual(creditOf(created[0]), { from: 'consult-1', pence: 1000 });
});

test('a ticked booking with no credit available, an unticked one, and a service needing no consultation record none', async () => {
  const { schedule, created } = fixture({ treatment: null });

  await schedule.createAppointmentByAdmin(colourFor(ADA)); // Ada has had no consultation
  await schedule.createAppointmentByAdmin(colourFor(MEI, { applyConsultationCredit: false }));
  await schedule.createAppointmentByAdmin(colourFor(MEI, { serviceId: 'blow-dry', durationMin: 45, expectedQuote: { serviceId: 'blow-dry', priceVersion: 1, amountPence: 4000 } }));
  await schedule.createAppointmentByAdmin(colourFor(MEI, { applyConsultationCredit: undefined }));

  assert.deepEqual(created.map(creditOf), [
    { from: null, pence: null },
    { from: null, pence: null },
    { from: null, pence: null },
    { from: null, pence: null },
  ]);
});

test('two bookings racing for one consultation: only one gets its credit', async () => {
  const { schedule, created } = fixture({ treatment: null });

  const results = await Promise.all([
    schedule.createAppointmentByAdmin(colourFor(MEI)),
    schedule.createAppointmentByAdmin(colourFor(MEI, { time: '15:00' })),
  ]);

  assert.ok(results.every((result) => result.success));
  assert.deepEqual(created.map(creditOf), [{ from: 'consult-1', pence: 1500 }, { from: null, pence: null }]);
});

test('a credit used by a cancelled booking is free again', async () => {
  const { schedule, created } = fixture({ treatment: { status: 'CANCELLED' } });

  await schedule.createAppointmentByAdmin(colourFor(MEI));

  assert.deepEqual(creditOf(created[0]), { from: 'consult-1', pence: 1500 });
});

const editColour = (overrides: Row = {}) => ({
  appointmentId: 'appt-1',
  ...SLOT,
  durationMin: 120,
  stylistId: 'stylist-1',
  serviceId: 'colour',
  notes: '',
  overrideClashes: false,
  expectedUpdatedAt: UPDATED_AT.toISOString(),
  ...overrides,
});

test('a staff move keeps the recorded credit as it is', async () => {
  const { schedule, rows, updates, creditLookups } = fixture();

  const result = await schedule.moveAppointmentByAdmin({
    appointmentId: 'appt-1', ...SLOT, time: '14:00', durationMin: 120, stylistId: 'stylist-1', overrideClashes: false, expectedUpdatedAt: UPDATED_AT.toISOString(),
  });

  assert.deepEqual(result, { success: true });
  assert.equal('consultationCreditFromId' in updates[0], false);
  assert.equal('consultationCreditPence' in updates[0], false);
  assert.deepEqual(creditOf(rows.find((row) => row.id === 'appt-1')!), { from: 'consult-1', pence: 1500 });
  assert.deepEqual(creditLookups, []);
});

test('an edit with the box ticked re-checks the credit, not counting the booking itself as its user', async () => {
  const { schedule, updates, creditLookups } = fixture();

  assert.deepEqual(await schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true })), { success: true });

  assert.deepEqual(creditOf(updates[0]), { from: 'consult-1', pence: 1500 });
  assert.deepEqual(creditLookups, [{ client: 'tx', inTransaction: true }]);
});

test('an edit with the box ticked records a credit that became available after booking', async () => {
  const { schedule, updates } = fixture({ treatment: { consultationCreditFromId: null, consultationCreditPence: null } });

  await schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true }));

  assert.deepEqual(creditOf(updates[0]), { from: 'consult-1', pence: 1500 });
});

test('an edit without the box (notes only) keeps the recorded credit', async () => {
  const { schedule, rows, updates, creditLookups } = fixture();

  assert.deepEqual(await schedule.editAppointmentByAdmin(editColour({ notes: 'Allergic to ammonia' })), { success: true });

  assert.equal('consultationCreditFromId' in updates[0], false);
  assert.deepEqual(creditOf(rows.find((row) => row.id === 'appt-1')!), { from: 'consult-1', pence: 1500 });
  assert.deepEqual(creditLookups, []);
});

test('re-checking a recorded credit keeps its consultation while it still qualifies, even with a newer one on file', async () => {
  const { schedule, updates } = fixture({ extraRows: [NEWER_CONSULTATION] });

  await schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true }));
  assert.deepEqual(creditOf(updates[0]), { from: 'consult-1', pence: 1500 });

  // A booking with no credit yet gets the most recent one.
  const fresh = fixture({ extraRows: [NEWER_CONSULTATION], treatment: { consultationCreditFromId: null, consultationCreditPence: null } });
  await fresh.schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true }));
  assert.deepEqual(creditOf(fresh.updates[0]), { from: 'consult-2', pence: 1500 });
});

test('unticking the box clears the recorded credit', async () => {
  const { schedule, updates, creditLookups } = fixture();

  await schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: false }));

  assert.deepEqual(creditOf(updates[0]), { from: null, pence: null });
  assert.deepEqual(creditLookups, []);
});

test('changing to a service that needs no consultation clears the credit, ticked or not', async () => {
  for (const applyConsultationCredit of [undefined, true]) {
    const { schedule, updates } = fixture();

    const result = await schedule.editAppointmentByAdmin(editColour({
      serviceId: 'blow-dry', durationMin: 45, applyConsultationCredit,
      expectedQuote: { serviceId: 'blow-dry', priceVersion: 1, amountPence: 4000 },
    }));

    assert.deepEqual(result, { success: true });
    assert.deepEqual(creditOf(updates[0]), { from: null, pence: null }, `applyConsultationCredit: ${applyConsultationCredit}`);
    assert.equal(updates[0].priceAtBooking, '40.00');
  }
});

test('changing to another consultation-required service re-caps the credit at the new price', async () => {
  const { schedule, updates } = fixture();

  await schedule.editAppointmentByAdmin(editColour({
    serviceId: 'toner', durationMin: 30, applyConsultationCredit: true,
    expectedQuote: { serviceId: 'toner', priceVersion: 1, amountPence: 1000 },
  }));

  assert.deepEqual(creditOf(updates[0]), { from: 'consult-1', pence: 1000 });
});

// Final review M8: a deposit already taken is part of the price, so the credit
// only takes off what it leaves — and a consultation is never used up for £0.
test('an edit caps the credit at what a taken deposit leaves of the price', async () => {
  const twenty = { priceAtBooking: '20.00' };
  const capped = fixture({ treatment: twenty, deposit: { status: 'CAPTURED', amountPence: 1000 } });
  await capped.schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true }));
  assert.deepEqual(creditOf(capped.updates[0]), { from: 'consult-1', pence: 1000 });

  const covered = fixture({ treatment: twenty, deposit: { status: 'CAPTURED', amountPence: 2000 } });
  await covered.schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true }));
  assert.deepEqual(creditOf(covered.updates[0]), { from: null, pence: null }, 'nothing left to deduct from');

  // A hold on the card is not money taken: the whole credit applies.
  const held = fixture({ treatment: twenty, deposit: { status: 'AUTHORIZED', amountPence: 1000 } });
  await held.schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true }));
  assert.deepEqual(creditOf(held.updates[0]), { from: 'consult-1', pence: 1500 });
});

test('a booking whose price was never recorded takes no credit', async () => {
  const { schedule, updates } = fixture({ treatment: { priceAtBooking: null, consultationCreditFromId: null, consultationCreditPence: null } });

  await schedule.editAppointmentByAdmin(editColour({ applyConsultationCredit: true }));

  assert.deepEqual(creditOf(updates[0]), { from: null, pence: null });
});

// --- The dialog's preview ---

const previewFor = (input: Row = {}) => ({ serviceId: 'colour', ...SLOT, ...input });

test('the preview shows the credit a new booking would take, and writes nothing', async () => {
  const { preview, writes, creditLookups } = fixture({ treatment: null });

  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ customerId: MEI.id })), {
    available: true, amountPence: 1500, consultationDate: CONSULTATION_DATE.toISOString(),
  });
  // A new customer typed with an email already on file is booked onto that account.
  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ email: ' Mei@Example.test ' })), {
    available: true, amountPence: 1500, consultationDate: CONSULTATION_DATE.toISOString(),
  });
  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ customerId: MEI.id, serviceId: 'toner' })), {
    available: true, amountPence: 1000, consultationDate: CONSULTATION_DATE.toISOString(),
  });

  for (const none of [
    previewFor({ customerId: ADA.id }),
    previewFor({ email: 'someone-new@example.test' }),
    previewFor({ customerId: MEI.id, serviceId: 'blow-dry' }),
    previewFor({}),
    previewFor({ customerId: MEI.id, dateStr: '15/10/2099' }),
  ]) {
    assert.deepEqual(await preview.previewConsultationCredit(none), { available: false }, JSON.stringify(none));
  }
  assert.equal(writes(), 0);
  assert.ok(creditLookups.every((lookup) => lookup.client === 'prisma' && !lookup.inTransaction));
});

test('the preview for a booking being edited does not count the booking itself as the credit\'s user', async () => {
  const { preview } = fixture({ treatment: { priceAtBooking: '12.00' } });

  // Mei's credit is held by appt-1, so a different booking would get none…
  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ customerId: MEI.id })), { available: false });
  // …but appt-1 itself still has it, capped at its RECORDED price while its service is unchanged.
  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ appointmentId: 'appt-1' })), {
    available: true, amountPence: 1200, consultationDate: CONSULTATION_DATE.toISOString(),
  });
  // A service change prices it at the new service's listed price.
  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ appointmentId: 'appt-1', serviceId: 'toner' })), {
    available: true, amountPence: 1000, consultationDate: CONSULTATION_DATE.toISOString(),
  });
});

test('the preview for a booking being edited caps the credit at what a taken deposit leaves', async () => {
  const { preview } = fixture({ treatment: { priceAtBooking: '20.00' }, deposit: { status: 'CAPTURED', amountPence: 1000 } });
  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ appointmentId: 'appt-1' })), {
    available: true, amountPence: 1000, consultationDate: CONSULTATION_DATE.toISOString(),
  });
  const covered = fixture({ treatment: { priceAtBooking: '20.00' }, deposit: { status: 'CAPTURED', amountPence: 2000 } });
  assert.deepEqual(await covered.preview.previewConsultationCredit(previewFor({ appointmentId: 'appt-1' })), { available: false });
});

test('the preview for a booking being edited names the consultation it already records', async () => {
  const { preview } = fixture({ extraRows: [NEWER_CONSULTATION] });

  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ appointmentId: 'appt-1' })), {
    available: true, amountPence: 1500, consultationDate: CONSULTATION_DATE.toISOString(),
  });
});

test('a preview the database could not answer fails, rather than saying no credit applies', async () => {
  // "No credit" would tell the dialog a recorded credit is gone and have saving remove it.
  const { preview } = fixture({ databaseDown: true });
  const quiet = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(preview.previewConsultationCredit(previewFor({ appointmentId: 'appt-1' })));
  } finally {
    console.error = quiet;
  }
});

test('the preview is for administrators only', async () => {
  const { preview, creditLookups } = fixture({ role: 'USER', treatment: null });

  assert.deepEqual(await preview.previewConsultationCredit(previewFor({ customerId: MEI.id })), { available: false });
  assert.deepEqual(creditLookups, [], 'nothing is read for a non-admin');
});
