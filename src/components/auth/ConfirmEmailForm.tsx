'use client';

import { useActionState } from 'react';
import { confirmEmailVerification, type ConfirmEmailState } from '@/app/actions/email-verification';
import { useT } from '@/i18n/client';

/**
 * The button on the page an emailed verification link opens. Opening the link
 * changes nothing; pressing this does. Success leaves for the outcome page, so
 * only a problem is ever shown here.
 */
export function ConfirmEmailForm({ token }: { token: string }) {
  const t = useT('auth');
  // The server action itself, never a client wrapper: only an action reference
  // renders a <form action> that submits before hydration or without JavaScript.
  const [state, action, pending] = useActionState<ConfirmEmailState, FormData>(confirmEmailVerification, { status: 'idle' });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === 'error' && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-md font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
      >
        {pending ? t('verifyEmail.confirming') : t('verifyEmail.confirm')}
      </button>
    </form>
  );
}
