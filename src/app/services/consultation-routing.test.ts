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
