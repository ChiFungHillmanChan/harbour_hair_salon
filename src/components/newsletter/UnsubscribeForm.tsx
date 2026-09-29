'use client';

import { useActionState } from 'react';
import {
  confirmUnsubscribe,
  unsubscribeFromMarketing,
  type ConfirmUnsubscribeState,
  type UnsubscribeState,
} from '@/app/actions/unsubscribe';
import Link from '@/i18n/link';
import { useT } from '@/i18n/client';

const initialState: UnsubscribeState = { status: 'idle' };
const initialConfirmState: ConfirmUnsubscribeState = { status: 'idle' };

const buttonClass = 'w-full rounded-md bg-zinc-900 px-5 py-3 text-sm font-bold uppercase tracking-[0.15em] text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60';

/** Asks for a confirmation link; the list itself changes only when that link is used. */
export function UnsubscribeForm({ defaultEmail = '' }: { defaultEmail?: string }) {
  const [state, action, pending] = useActionState(unsubscribeFromMarketing, initialState);
  const t = useT('legal');

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-800 mb-2">
          {t('unsubscribe.email')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={defaultEmail}
          className="w-full rounded-md border border-zinc-300 px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          placeholder={t('unsubscribe.placeholder')}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass}
      >
        {pending ? t('unsubscribe.updating') : t('unsubscribe.submit')}
      </button>
      {state.status !== 'idle' && (
        <p
          className={state.status === 'success' ? 'text-sm text-green-700' : 'text-sm text-red-700'}
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * What an emailed link opens. Unsubscribing takes this button press — opening
 * the link alone changes nothing, so mail scanners that follow links cannot.
 */
export function ConfirmUnsubscribeForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(confirmUnsubscribe, initialConfirmState);
  const t = useT('legal');

  if (state.status === 'success') {
    return <p className="text-sm text-green-700" role="status">{state.message}</p>;
  }

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm leading-6 text-zinc-600">{t('unsubscribe.confirm.intro', { email })}</p>
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? t('unsubscribe.confirm.updating') : t('unsubscribe.confirm.submit')}
      </button>
      {state.status === 'error' && (
        <p className="text-sm text-red-700" role="status">
          {state.message}
          {state.linkInvalid && (
            <>
              {' '}
              <Link href="/unsubscribe" className="text-zinc-900 underline">{t('unsubscribe.confirm.requestNew')}</Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
