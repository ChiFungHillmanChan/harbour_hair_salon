import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceSchemaItems } from './json-ld';
import type { PriceListEntry } from './public-catalog';
import type { ClientPublicService } from '../public-service-select';

const labels = { hairLength: (length: string) => length, describe: (name: string) => `${name} at Harbour Hair Salon` };
const service = (overrides: Partial<ClientPublicService>) => ({
  id: 's', name: 'Service', description: null, amountPence: 15700, price: 157, priceType: 'STANDARD', vatDisplay: 'UNSPECIFIED',
  priceNature: 'LISTED', requiresConsultation: false, hairLength: null, ...overrides,
}) as ClientPublicService;
const offerOf = (entry: PriceListEntry) => serviceSchemaItems([entry], labels)[0].offers as Record<string, unknown>;

test('a consultation-required service publishes a starting price, never a fixed one', () => {
  const offer = offerOf({ kind: 'single', service: service({ requiresConsultation: true, priceNature: 'SUBJECT_TO_CONSULTATION' }) });
  assert.equal('price' in offer, false);
  assert.deepEqual(offer.priceSpecification, { '@type': 'PriceSpecification', minPrice: '157.00', priceCurrency: 'GBP' });
});

test('a listed service keeps its fixed price', () => {
  const offer = offerOf({ kind: 'single', service: service({ amountPence: 4000 }) });
  assert.equal(offer.price, '40.00');
  assert.equal(offer.priceCurrency, 'GBP');
});

test('a service whose price is subject to consultation is a starting price even when the row does not require one', () => {
  const offer = offerOf({ kind: 'single', service: service({ priceNature: 'SUBJECT_TO_CONSULTATION' }) });
  assert.equal('price' in offer, false);
  assert.equal((offer.priceSpecification as Record<string, unknown>).minPrice, '157.00');
});
