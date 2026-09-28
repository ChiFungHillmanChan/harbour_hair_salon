'use server';

import { revalidatePath } from 'next/cache';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { verifySession } from '@/app/lib/session';
import { runOperationsDiagnostics } from '@/app/services/operations-readiness';
import { dispatchPendingNotifications } from '@/app/services/notification-outbox-service';
import { getActionT } from '@/i18n/request';

export type OperationsActionState = { status: 'idle' | 'success' | 'error'; message?: string };

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
}

export async function runOperationsDiagnosticsAction(): Promise<OperationsActionState> {
  await requireAdmin();
  const t = await getActionT('adminOps');
  try {
    const checks = await runOperationsDiagnostics();
    revalidateAllLocales(revalidatePath, '/admin/operations');
    const failures = checks.filter((check) => check.status !== 'pass').length;
    return { status: failures ? 'error' : 'success', message: failures
      ? t('operations.results.checksNeedAttention', { count: failures })
      : t('operations.results.checksPassed') };
  } catch {
    return { status: 'error', message: t('operations.results.reportFailed') };
  }
}

/** The named button and server-validated acknowledgement authorise actual queued sends. */
export async function processDueNotificationsAction(_previous: OperationsActionState, formData: FormData): Promise<OperationsActionState> {
  await requireAdmin();
  const t = await getActionT('adminOps');
  if (formData.get('confirmSend') !== 'on') return { status: 'error', message: t('operations.results.confirmRequired') };
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') return { status: 'error', message: t('operations.results.deliveryDisabled') };
  try {
    const result = await dispatchPendingNotifications({ limit: 10, budgetMs: 15_000 });
    revalidateAllLocales(revalidatePath, '/admin/operations');
    return { status: 'success', message: t('operations.results.processed', { sent: result.sent, failed: result.failed, deferred: result.deferred, skipped: result.skipped }) };
  } catch {
    return { status: 'error', message: t('operations.results.processFailed') };
  }
}
