import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../../test/load-server-module';

const row = (id: string, requiresConsultation: boolean, priceNature: string) => ({
  id, name: id, description: null, price: '157.00', duration: 60, category: 'Colouring', imageUrl: null, requiresPatchTest: false,
  isPatchTest: false, requiresConsultation, isConsultation: false, offeringId: null, hairLength: null, priceType: 'STANDARD', isBookable: true,
  priceVersion: 1, vatDisplay: 'EXCLUDED', priceNature, durationConfirmed: true, priceNote: null, surchargeBaseServiceId: null, surchargeAmount: null,
});

test('every public service reads its price nature through the consultation rule', async () => {
  const { getPublicCatalog } = loadServerModule<typeof import('./public-catalog')>('src/app/services/pricing/public-catalog.ts', {
    '@/app/lib/prisma': {
      __esModule: true,
      default: { service: { findMany: async () => [row('colour', true, 'LISTED'), row('cut', false, 'LISTED')] }, serviceOffering: { findMany: async () => [] } },
    },
    '../content/translations': { loadPublishedTranslations: async () => new Map(), overlay: (value: object) => ({ ...value, translated: true }) },
  });
  const catalog = await getPublicCatalog('en-GB');
  const nature = (id: string) => catalog.services.find((service) => service.id === id)?.priceNature;
  assert.equal(nature('colour'), 'SUBJECT_TO_CONSULTATION');
  assert.equal(nature('cut'), 'LISTED');
});
