'use client';

import { useTransition } from 'react';
import { eraseCustomerData } from '@/app/actions/admin-erasure';
import { useT } from '@/i18n/client';

/**
 * Admin -> Users erasure: the admin types `expected` (the customer's address,
 * or ERASE for a phone booking without one) to confirm; the server re-checks
 * the confirmation and every other rule (actions/admin-erasure.ts). The page
 * refreshes itself through the action's revalidation.
 */
export function EraseCustomerButton({ userId, name, expected }: { userId: string; name: string; expected: string }) {
  const t = useT('adminOps');
  const [pending, startTransition] = useTransition();
  const erase = () => {
    const typed = window.prompt(t('users.erasure.prompt', { name, expected }));
    if (typed === null) return;
    startTransition(async () => {
      const result = await eraseCustomerData(userId, typed);
      window.alert(result.success ? result.message : result.error);
    });
  };
  return (
    <button
      type="button"
      onClick={erase}
      disabled={pending}
      className="rounded border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? t('users.erasure.erasing') : t('users.erasure.button')}
    </button>
  );
}
