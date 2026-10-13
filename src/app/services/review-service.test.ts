import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { ERASED_CUSTOMER_NAME } from '../lib/customer-erasure';

test('an erased customer’s public review keeps its rating and text but shows no author name', async () => {
  const review = (id: string, name: string | null) => ({
    id, rating: 5, comment: `Comment ${id}`, createdAt: new Date('2099-01-01'),
    user: { name }, appointment: { serviceId: 'svc', service: { name: 'Cut' }, stylist: { name: 'Ivan' } },
  });
  const service = loadServerModule<typeof import('./review-service')>('src/app/services/review-service.ts', {
    '@/app/lib/session': { requireAdmin: async () => ({ role: 'ADMIN' }) },
    '@/app/lib/prisma': { review: { findMany: async () => [review('kept', 'Amy'), review('erased', ERASED_CUSTOMER_NAME), review('anonymous', null)] } },
    './content/translations': { loadPublishedTranslations: async () => new Map() },
  });
  const reviews = await service.getApprovedReviews();
  assert.deepEqual(reviews.map((row) => [row.id, row.user.name, row.rating, row.comment]), [
    ['kept', 'Amy', 5, 'Comment kept'],
    ['erased', null, 5, 'Comment erased'],
    ['anonymous', null, 5, 'Comment anonymous'],
  ]);
});
