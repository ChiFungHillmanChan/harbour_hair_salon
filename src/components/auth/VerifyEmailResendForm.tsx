'use client';

import { useActionState } from 'react';
import { resendVerificationEmail, type ResendVerificationState } from '@/app/actions/email-verification';
import { useT } from '@/i18n/client';

/** "Email me a new link" for a signed-in customer whose address is not yet confirmed. */
export function VerifyEmailResendForm({ email }: { email: string }) {
  const t = useT('auth');
  // The server action itself, never a client wrapper: only an action reference
  // renders a <form action> that submits before hydration or without JavaScript.
  const [state, action, pending] = useActionState<ResendVerificationState, FormData>(resendVerificationEmail, { status: 'idle' });
  return (
    <form action={action} className="space-y-4">
      {state.status === 'sent' && <p role="status" className="text-sm text-zinc-700">{t('verifyEmail.sent', { email })}</p>}
      {state.status === 'verified' && <p role="status" className="text-sm text-zinc-700">{t('verifyEmail.alreadyVerified')}</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      <button
        disabled={pending}
        className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-md font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
      >
        {pending ? t('verifyEmail.resending') : t('verifyEmail.resend')}
      </button>
    </form>
  );
}
