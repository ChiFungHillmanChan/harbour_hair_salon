import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingError } from './booking-errors';
import { DEPOSITS_OFF, depositForQuote, quoteDepositForNewBooking, readDepositSettings, type DepositSettings } from './deposit-quote';

function settings(overrides: Partial<DepositSettings> = {}): DepositSettings {
  return { depositsEnabled: true, depositPercent: 20, depositMinimumServicePence: 3000, ...overrides };
}

function deposit(quoteAmountPence: number, overrides: Partial<DepositSettings> = {}, overridePence: number | null = null) {
  const { depositPence, remainderPence } = depositForQuote({ quoteAmountPence, settings: settings(overrides), overridePence });
  return { depositPence, remainderPence };
}

test('deposits switched off take nothing, whatever the percentage or a fixed override says', () => {
  for (const overridePence of [null, 0, 1500]) {
    assert.deepEqual(deposit(8000, { depositsEnabled: false }, overridePence), { depositPence: 0, remainderPence: 8000 });
  }
  // A settings row that was never saved: the column defaults, i.e. off.
  assert.equal(depositForQuote({ quoteAmountPence: 8000, settings: DEPOSITS_OFF, overridePence: null }).depositPence, 0);
});

test('a service quoted below the minimum takes no percentage deposit; at the minimum it does', () => {
  assert.deepEqual(deposit(2999), { depositPence: 0, remainderPence: 2999 });
  assert.deepEqual(deposit(3000), { depositPence: 600, remainderPence: 2400 });
  assert.deepEqual(deposit(15700), { depositPence: 3140, remainderPence: 12560 });
  // No minimum: every priced service qualifies.
  assert.deepEqual(deposit(500, { depositMinimumServicePence: 0 }), { depositPence: 100, remainderPence: 400 });
});

test('the percentage rounds half a penny up, and deposit plus remainder is always exactly the price', () => {
  assert.equal(deposit(3010, { depositPercent: 25, depositMinimumServicePence: 0 }).depositPence, 753); // 752.5p
  assert.equal(deposit(4999, { depositPercent: 33, depositMinimumServicePence: 0 }).depositPence, 1650); // 1649.67p
  assert.equal(deposit(4999, { depositPercent: 10, depositMinimumServicePence: 0 }).depositPence, 500); // 499.9p
  assert.equal(deposit(1, { depositPercent: 49, depositMinimumServicePence: 0 }).depositPence, 0); // 0.49p
  assert.equal(deposit(1, { depositPercent: 50, depositMinimumServicePence: 0 }).depositPence, 1); // 0.5p
  assert.deepEqual(deposit(8000, { depositPercent: 0 }), { depositPence: 0, remainderPence: 8000 });
  assert.deepEqual(deposit(8000, { depositPercent: 100 }), { depositPence: 8000, remainderPence: 0 });
  for (const price of [1, 99, 101, 2999, 4999, 15700, 19400]) {
    for (const percent of [0, 1, 7, 15, 33, 50, 99, 100]) {
      const result = deposit(price, { depositPercent: percent, depositMinimumServicePence: 0 });
      assert.equal(result.depositPence + result.remainderPence, price, `${percent}% of ${price}p`);
      assert.ok(Number.isSafeInteger(result.depositPence) && result.depositPence >= 0 && result.depositPence <= price);
    }
  }
});

test('an override of 0 means the service never takes a deposit', () => {
  assert.deepEqual(deposit(15700, {}, 0), { depositPence: 0, remainderPence: 15700 });
  assert.deepEqual(deposit(15700, { depositPercent: 100 }, 0), { depositPence: 0, remainderPence: 15700 });
});

test('a fixed override replaces the percentage and the minimum, and is capped at the price', () => {
  assert.deepEqual(deposit(15700, {}, 2500), { depositPence: 2500, remainderPence: 13200 });
  // Below the salon minimum, a fixed deposit still applies: it was set for this service.
  assert.deepEqual(deposit(1000, {}, 500), { depositPence: 500, remainderPence: 500 });
  // An override above the price (e.g. the price was lowered later) takes the whole price, never more.
  assert.deepEqual(deposit(1500, {}, 5000), { depositPence: 1500, remainderPence: 0 });
  assert.deepEqual(deposit(1500, {}, 1500), { depositPence: 1500, remainderPence: 0 });
});

test('a free service never takes a deposit, even with a fixed override or 100%', () => {
  assert.deepEqual(deposit(0, { depositPercent: 100, depositMinimumServicePence: 0 }), { depositPence: 0, remainderPence: 0 });
  assert.deepEqual(deposit(0, {}, 1000), { depositPence: 0, remainderPence: 0 });
});

test('the policy that produced the amount is returned for the payment record', () => {
  assert.deepEqual(depositForQuote({ quoteAmountPence: 15700, settings: settings({ depositPercent: 15 }), overridePence: null }).policy, {
    enabled: true, percent: 15, minimumServicePence: 3000, overridePence: null,
  });
  assert.deepEqual(depositForQuote({ quoteAmountPence: 15700, settings: DEPOSITS_OFF, overridePence: 2500 }).policy, {
    enabled: false, percent: 0, minimumServicePence: 0, overridePence: 2500,
  });
});

test('an impossible stored policy refuses instead of guessing an amount', () => {
  assert.throws(() => deposit(5000, { depositPercent: 101 }), RangeError);
  assert.throws(() => deposit(5000, { depositPercent: -1 }), RangeError);
  assert.throws(() => deposit(5000, { depositMinimumServicePence: -1 }), RangeError);
  assert.throws(() => deposit(5000, {}, -100), RangeError);
  assert.throws(() => deposit(5000, {}, 12.5), RangeError);
  assert.throws(() => deposit(-1), RangeError);
  // Even while switched off: a broken row is a fault to surface, not a free booking.
  assert.throws(() => deposit(5000, { depositsEnabled: false, depositPercent: 150 }), RangeError);
});

type FakeService = {
  id: string; price: string; duration: number; offeringId: string | null; hairLength: string | null; priceType: string;
  priceVersion: number; vatDisplay: string; priceNature: string; durationConfirmed: boolean; surchargeBaseServiceId: string | null;
  surchargeAmount: string | null; priceSource: string | null; isPublic: boolean; isBookable: boolean; depositOverridePence?: number | null;
};

function service(overrides: Partial<FakeService> = {}): FakeService {
  return {
    id: 'cut', price: '50.00', duration: 60, offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 4,
    vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED', durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null,
    priceSource: null, isPublic: true, isBookable: true, depositOverridePence: null, ...overrides,
  };
}

function fakeDb(services: FakeService[], row: DepositSettings | null = settings()) {
  const reads: string[] = [];
  const db = {
    siteSettings: {
      findUnique: async (args: { where: { id: string }; select: Record<string, boolean> }) => {
        reads.push('settings');
        assert.deepEqual(args.where, { id: 'singleton' });
        assert.deepEqual(Object.keys(args.select).sort(), ['depositMinimumServicePence', 'depositPercent', 'depositsEnabled']);
        return row;
      },
    },
    service: {
      findUnique: async (args: { where: { id: string } }) => {
        reads.push(`service:${args.where.id}`);
        return services.find((candidate) => candidate.id === args.where.id) ?? null;
      },
    },
  };
  return { db: db as never, reads };
}

test('the deposit is worked out from the server quote and the settings row read now', async () => {
  const f = fakeDb([service()]);
  const result = await quoteDepositForNewBooking(f.db, 'cut');
  assert.equal(result.quote.amountPence, 5000);
  assert.equal(result.quote.priceVersion, 4);
  assert.equal(result.deposit.depositPence, 1000);
  assert.equal(result.deposit.remainderPence, 4000);
  // Every call reads the row again: nothing is remembered between requests.
  await quoteDepositForNewBooking(f.db, 'cut');
  assert.deepEqual(f.reads, ['service:cut', 'settings', 'service:cut', 'settings']);
});

test('a service override is taken from the same service read as the quote', async () => {
  const f = fakeDb([service({ depositOverridePence: 1500 }), service({ id: 'free-consult', price: '0.00', depositOverridePence: null })]);
  assert.equal((await quoteDepositForNewBooking(f.db, 'cut')).deposit.depositPence, 1500);
  assert.equal((await quoteDepositForNewBooking(f.db, 'free-consult')).deposit.depositPence, 0);
  // A client generated before the column existed answers undefined: salon policy.
  const legacy = fakeDb([{ ...service(), depositOverridePence: undefined }]);
  assert.equal((await quoteDepositForNewBooking(legacy.db, 'cut')).deposit.depositPence, 1000);
});

test('a settings row that was never saved means no deposit', async () => {
  const f = fakeDb([service()], null);
  assert.deepEqual(await readDepositSettings(f.db), DEPOSITS_OFF);
  const result = await quoteDepositForNewBooking(f.db, 'cut');
  assert.equal(result.deposit.depositPence, 0);
  assert.equal(result.deposit.remainderPence, 5000);
});

test('an extra-long composite takes its deposit from base price plus surcharge', async () => {
  const f = fakeDb([
    service({ id: 'colour-long', price: '157.00' }),
    service({ id: 'colour-extra-long', price: '194.00', surchargeBaseServiceId: 'colour-long', surchargeAmount: '37.00' }),
  ]);
  const result = await quoteDepositForNewBooking(f.db, 'colour-extra-long');
  assert.equal(result.quote.amountPence, 19400);
  assert.deepEqual({ depositPence: result.deposit.depositPence, remainderPence: result.deposit.remainderPence }, { depositPence: 3880, remainderPence: 15520 });
});

test('unknown, retired, unlisted and inconsistently priced services are refused before the policy is read', async () => {
  const f = fakeDb([
    service({ id: 'retired', isBookable: false }),
    service({ id: 'staff-only', isPublic: false }),
    service({ id: 'broken-composite', price: '200.00', surchargeBaseServiceId: 'missing', surchargeAmount: '37.00' }),
  ]);
  const errors = console.error;
  console.error = () => {};
  try {
    for (const [id, code] of [['nope', 'SERVICE_NOT_FOUND'], ['retired', 'SERVICE_NOT_BOOKABLE'], ['staff-only', 'SERVICE_NOT_BOOKABLE'], ['broken-composite', 'PRICE_UNAVAILABLE']] as const) {
      await assert.rejects(quoteDepositForNewBooking(f.db, id), (error: unknown) => error instanceof BookingError && error.code === code, id);
    }
  } finally {
    console.error = errors;
  }
  assert.equal(f.reads.includes('settings'), false);
});
