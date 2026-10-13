import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

function serviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cut', price: '50.00', duration: 60, offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 2,
    vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED', durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null,
    priceSource: null, isPublic: true, isBookable: true, depositOverridePence: null, ...overrides,
  };
}

type Options = {
  open?: boolean;
  allowed?: boolean;
  forwardedFor?: string | null;
  settings?: Record<string, unknown> | null;
  services?: Record<string, ReturnType<typeof serviceRow>>;
  databaseDown?: boolean;
};

function fixture(options: Options = {}) {
  const calls = { gate: 0, limiter: [] as string[], reads: [] as string[], errors: 0 };
  const services = options.services ?? { cut: serviceRow() };
  const unreachable = () => { throw new Error("Can't reach database server"); };
  const db = {
    siteSettings: {
      findUnique: async () => {
        calls.reads.push('settings');
        if (options.databaseDown) unreachable();
        return options.settings === undefined ? { depositsEnabled: true, depositPercent: 20, depositMinimumServicePence: 0 } : options.settings;
      },
    },
    service: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.reads.push(`service:${where.id}`);
        if (options.databaseDown) unreachable();
        return services[where.id] ?? null;
      },
    },
  };
  const actions = loadServerModule<typeof import('./booking-quote')>('src/app/actions/booking-quote.ts', {
    'next/headers': {
      headers: async () => new Headers(options.forwardedFor === null ? {} : { 'x-forwarded-for': options.forwardedFor ?? '203.0.113.7, 10.0.0.1' }),
    },
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => { calls.gate++; return options.open ?? true; } },
    // The same limiter object the public availability actions use (by name).
    '@/app/lib/rate-limit': { availabilityLimiter: { check: async (key: string) => { calls.limiter.push(key); return options.allowed ?? true; } } },
  });
  return { actions, calls };
}

async function quietly<T>(calls: { errors: number }, run: () => Promise<T>): Promise<T> {
  const errors = console.error;
  console.error = () => { calls.errors++; };
  try {
    return await run();
  } finally {
    console.error = errors;
  }
}

test('quotes the price, the deposit now and the rest payable in the salon', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.previewBookingQuote('cut'), { ok: true, amountPence: 5000, depositPence: 1000, remainderPence: 4000 });
  assert.deepEqual(f.calls.limiter, ['203.0.113.7'], 'one hit on the per-address availability budget, keyed by the client address');
  assert.deepEqual(f.calls.reads, ['service:cut', 'settings']);
});

test('deposits switched off, an override of 0 or a free service quote no deposit', async () => {
  const off = fixture({ settings: { depositsEnabled: false, depositPercent: 20, depositMinimumServicePence: 0 } });
  assert.deepEqual(await off.actions.previewBookingQuote('cut'), { ok: true, amountPence: 5000, depositPence: 0, remainderPence: 5000 });
  const never = fixture({ services: { cut: serviceRow({ depositOverridePence: 0 }) } });
  assert.deepEqual(await never.actions.previewBookingQuote('cut'), { ok: true, amountPence: 5000, depositPence: 0, remainderPence: 5000 });
  const unsaved = fixture({ settings: null });
  assert.deepEqual(await unsaved.actions.previewBookingQuote('cut'), { ok: true, amountPence: 5000, depositPence: 0, remainderPence: 5000 });
  const free = fixture({ services: { consult: serviceRow({ id: 'consult', price: '0.00' }) } });
  assert.deepEqual(await free.actions.previewBookingQuote('consult'), { ok: true, amountPence: 0, depositPence: 0, remainderPence: 0 });
});

test('a fixed service deposit is quoted, never more than the price', async () => {
  const fixed = fixture({ services: { cut: serviceRow({ depositOverridePence: 1500 }) } });
  assert.deepEqual(await fixed.actions.previewBookingQuote('cut'), { ok: true, amountPence: 5000, depositPence: 1500, remainderPence: 3500 });
  const capped = fixture({ services: { cut: serviceRow({ depositOverridePence: 9000 }) } });
  assert.deepEqual(await capped.actions.previewBookingQuote('cut'), { ok: true, amountPence: 5000, depositPence: 5000, remainderPence: 0 });
});

test('junk ids are refused before the booking gate, the limiter or the database', async () => {
  const f = fixture();
  for (const id of ['', '   ', 'x'.repeat(65), 42, null, undefined, { id: 'cut' }, ['cut']]) {
    assert.deepEqual(await f.actions.previewBookingQuote(id as string), { ok: false }, JSON.stringify(id));
  }
  assert.deepEqual(f.calls, { gate: 0, limiter: [], reads: [], errors: 0 });
});

test('while booking is closed nothing is quoted, the budget is not spent and the database is not woken', async () => {
  const f = fixture({ open: false });
  assert.deepEqual(await f.actions.previewBookingQuote('cut'), { ok: false });
  assert.equal(f.calls.gate, 1);
  assert.deepEqual(f.calls.limiter, []);
  assert.deepEqual(f.calls.reads, []);
});

test('an address over the availability budget is refused before any database read', async () => {
  const f = fixture({ allowed: false });
  assert.deepEqual(await f.actions.previewBookingQuote('cut'), { ok: false });
  assert.deepEqual(f.calls.reads, []);
  const anonymous = fixture({ allowed: false, forwardedFor: null });
  await anonymous.actions.previewBookingQuote('cut');
  assert.deepEqual(anonymous.calls.limiter, ['unknown']);
});

test('unknown, retired and unlisted services get no quote, as ordinary refusals', async () => {
  const f = fixture({ services: { retired: serviceRow({ id: 'retired', isBookable: false }), staff: serviceRow({ id: 'staff', isPublic: false }) } });
  await quietly(f.calls, async () => {
    for (const id of ['missing', 'retired', 'staff']) assert.deepEqual(await f.actions.previewBookingQuote(id), { ok: false }, id);
  });
  assert.equal(f.calls.errors, 0, 'a refusal is not logged as a fault');
  assert.equal(f.calls.reads.includes('settings'), false);
});

test('a database failure or an impossible stored policy is logged and refused, never guessed', async () => {
  const down = fixture({ databaseDown: true });
  assert.deepEqual(await quietly(down.calls, () => down.actions.previewBookingQuote('cut')), { ok: false });
  assert.equal(down.calls.errors, 1);
  const broken = fixture({ settings: { depositsEnabled: true, depositPercent: 150, depositMinimumServicePence: 0 } });
  assert.deepEqual(await quietly(broken.calls, () => broken.actions.previewBookingQuote('cut')), { ok: false });
  assert.equal(broken.calls.errors, 1);
});
