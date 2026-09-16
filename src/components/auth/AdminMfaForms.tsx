'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { beginMfaEnrollment, finishMfaEnrollment, verifyAdminMfa } from '@/app/actions/admin-mfa';

const fieldClass = 'mt-2 block w-full rounded border border-zinc-300 px-3 py-3 text-zinc-900';
const buttonClass = 'w-full rounded bg-zinc-900 px-4 py-3 font-semibold text-white disabled:opacity-50';

export function AdminMfaVerifyForm() {
  const [state, action, pending] = useActionState(verifyAdminMfa, {});
  return <form action={action} className="space-y-5">
    <label className="block text-sm text-zinc-700">Authenticator or recovery code<input name="code" autoComplete="one-time-code" autoFocus required maxLength={64} className={fieldClass} /></label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending} className={buttonClass}>{pending ? 'Verifying…' : 'Verify and sign in'}</button>
    <p className="text-xs text-zinc-500">If your authenticator is unavailable, enter one of the recovery codes saved when you enabled it. Each recovery code works once.</p>
    <Link href="/auth/signin" className="block text-sm text-zinc-600 underline">Start sign-in again</Link>
  </form>;
}

export function AdminMfaSetupForm({ requiresPassword, enrolled = false }: { requiresPassword: boolean; enrolled?: boolean }) {
  const [setup, start, starting] = useActionState(beginMfaEnrollment, {});
  const [finish, confirm, confirming] = useActionState(finishMfaEnrollment, {});
  if (finish.recoveryCodes) return <div className="space-y-5">
    <p className="font-medium text-zinc-900">Authenticator enabled. Save these recovery codes now.</p>
    <p className="text-sm text-zinc-600">Store them in your password manager or another private place. They will not be shown again, and each can be used once if you lose access to your authenticator.</p>
    <ul className="space-y-2 rounded border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-900">{finish.recoveryCodes.map((code) => <li key={code}>{code}</li>)}</ul>
    <Link href="/admin" className={`${buttonClass} block text-center`}>I have saved my codes — continue</Link>
  </div>;
  if (enrolled) return <div className="space-y-5">
    <p className="text-sm text-zinc-700">Authenticator verification is enabled. Recovery codes are only shown once, immediately after setup.</p>
    <Link href="/admin" className={`${buttonClass} block text-center`}>Continue to administration</Link>
  </div>;
  return <div className="space-y-6">
    {!setup.secret ? <form action={start} className="space-y-5">
      {requiresPassword && <label className="block text-sm text-zinc-700">Current password<input name="password" type="password" autoComplete="current-password" required maxLength={128} className={fieldClass} /></label>}
      <p className="text-sm text-zinc-600">You need an authenticator app to protect customer and payroll records. Keep it available whenever you sign in as an administrator.</p>
      {setup.error && <p role="alert" className="text-sm text-red-700">{setup.error}</p>}
      <button disabled={starting} className={buttonClass}>{starting ? 'Preparing…' : 'Set up authenticator'}</button>
    </form> : <>
      <p className="text-sm text-zinc-700">Add a time-based code in your authenticator app using this setup key:</p>
      <code className="block break-all rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-900">{setup.secret}</code>
      <a href={setup.uri} className="block text-sm text-zinc-700 underline">Open in an authenticator app on this device</a>
      <form action={confirm} className="space-y-5">
        <label className="block text-sm text-zinc-700">Six-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required className={fieldClass} /></label>
        {finish.error && <p role="alert" className="text-sm text-red-700">{finish.error}</p>}
        <button disabled={confirming} className={buttonClass}>{confirming ? 'Verifying…' : 'Verify and enable'}</button>
      </form>
    </>}
    <Link href="/auth/signin" className="block text-sm text-zinc-600 underline">Start sign-in again</Link>
  </div>;
}
