import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConsultationTarget, type RoutableService } from './consultation-routing';

function svc(over: Partial<RoutableService>): RoutableService {
  return {
    id: 'x', name: 'X', requiresConsultation: false, requiresPatchTest: false,
    isConsultation: false, isPatchTest: false, price: 0, ...over,
  };
}

const freeConsult = svc({ id: 'c', name: 'Consultation', isConsultation: true, price: 0 });
const patchTest = svc({ id: 'p', name: 'Consultation & Patch Test', isPatchTest: true, price: 10 });
const all = [freeConsult, patchTest];

test('directly-bookable service → null', () => {
  const haircut = svc({ id: 'h', name: 'Haircut', requiresConsultation: false });
  assert.equal(resolveConsultationTarget(haircut, [...all, haircut]), null);
});

test('colour service (requiresPatchTest) → routes to the £10 patch test', () => {
  const colour = svc({ id: 'col', name: 'Full Head Colour', requiresConsultation: true, requiresPatchTest: true, price: 110 });
  const r = resolveConsultationTarget(colour, [...all, colour]);
  assert.equal(r?.target.id, 'p');
  assert.equal(r?.fee, 10);
});

test('non-colour gated service (perm) → routes to the free Consultation', () => {
  const perm = svc({ id: 'perm', name: 'Cold Perm', requiresConsultation: true, price: 143 });
  const r = resolveConsultationTarget(perm, [...all, perm]);
  assert.equal(r?.target.id, 'c');
  assert.equal(r?.fee, 0);
});

test('gated but free Consultation service missing → null (caller falls back)', () => {
  const perm = svc({ id: 'perm', name: 'Cold Perm', requiresConsultation: true, price: 143 });
  assert.equal(resolveConsultationTarget(perm, [patchTest, perm]), null);
});

test('gated colour but patch-test service missing → null', () => {
  const colour = svc({ id: 'col', name: 'Colour', requiresConsultation: true, requiresPatchTest: true });
  assert.equal(resolveConsultationTarget(colour, [freeConsult, colour]), null);
});

test('consultationFeeByServiceId gives each gated service its own consultation’s price, never a literal', async () => {
  const { consultationFeeByServiceId } = await import('./consultation-routing');
  const row = (over: Partial<RoutableService> & { amountPence: number }) => ({ ...svc(over), ...over });
  const consult = row({ id: 'c', isConsultation: true, price: 25, amountPence: 2500 });
  const patch = row({ id: 'p', isPatchTest: true, price: 15, amountPence: 1500 });
  const colour = row({ id: 'col', requiresConsultation: true, requiresPatchTest: true, price: 110, amountPence: 11000 });
  const perm = row({ id: 'perm', requiresConsultation: true, price: 143, amountPence: 14300 });
  const cut = row({ id: 'cut', price: 40, amountPence: 4000 });
  assert.deepEqual(consultationFeeByServiceId([consult, patch, colour, perm, cut]), { col: 1500, perm: 2500 });
  // No consultation to route to: nothing promised.
  assert.deepEqual(consultationFeeByServiceId([perm, cut]), {});
});
