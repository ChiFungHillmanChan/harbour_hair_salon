import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminNoticeError, adminFacingMessage } from './admin-notice';

test('only our own translated notices reach the admin verbatim', () => {
  assert.equal(adminFacingMessage(new AdminNoticeError('有 3 個預約，請改為停用'), 'Could not delete'), '有 3 個預約，請改為停用');
  const prismaLike = Object.assign(new Error('Foreign key constraint violated: `Appointment_serviceId_fkey (index)`'), { code: 'P2003' });
  assert.equal(adminFacingMessage(prismaLike, 'Could not delete'), 'Could not delete');
  assert.equal(adminFacingMessage('boom', 'Could not delete'), 'Could not delete');
});
