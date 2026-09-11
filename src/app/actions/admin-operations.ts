'use server';

import { revalidatePath } from 'next/cache';
import { verifySession } from '@/app/lib/session';
import { runOperationsDiagnostics } from '@/app/services/operations-readiness';
import { dispatchPendingNotifications } from '@/app/services/notification-outbox-service';

export type OperationsActionState = { status: 'idle' | 'success' | 'error'; message?: string };

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
}

export async function runOperationsDiagnosticsAction(): Promise<OperationsActionState> {
  await requireAdmin();
  try {
    const checks = await runOperationsDiagnostics();
    revalidatePath('/admin/operations');
    const failures = checks.filter((check) => check.status !== 'pass').length;
    return { status: failures ? 'error' : 'success', message: failures
      ? `${failures} checks need attention. No emails were sent.`
      : 'Read-only checks passed. Complete the salon acceptance tests before enabling booking.' };
  } catch {
    return { status: 'error', message: 'The readiness report could not be saved. Check database availability and retry.' };
  }
}

/** The named button and server-validated acknowledgement authorise actual queued sends. */
export async function processDueNotificationsAction(_previous: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  await requireAdmin();
  if (formData.get('confirmSend') !== 'on') return { status: 'error', message: 'Confirm that you intend to send due booking notifications.' };
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') return { status: 'error', message: 'Notification delivery is disabled in this environment.' };
  try {
    const result = await dispatchPendingNotifications({ limit: 10, budgetMs: 15_000 });
    revalidatePath('/admin/operations');
    return { status: 'success', message: `Sent: ${result.sent}. Failed: ${result.failed}. Deferred: ${result.deferred}. Skipped: ${result.skipped}.` };
  } catch {
    return { status: 'error', message: 'Notification processing did not complete. Review the delivery history before retrying.' };
  }
}
