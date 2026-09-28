'use client';

import { useActionState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from '@/i18n/link';
import { beginMfaEnrollment, finishMfaEnrollment, verifyAdminMfa } from '@/app/actions/admin-mfa';
import { useT } from '@/i18n/client';
import { clearDraft, saveDraft, useDraftState, usePreservedForm } from '@/i18n/draft-store';

const fieldClass = 'mt-2 block w-full rounded border border-zinc-300 px-3 py-3 text-zinc-900';
const buttonClass = 'w-full rounded bg-zinc-900 px-4 py-3 font-semibold text-white disabled:opacity-50';

// The server actions are passed to useActionState AS THEY ARE, never wrapped in
// a client function: only a server-action reference lets React render a real
// <form action> with its $ACTION_ fields, so these forms still submit without
// JavaScript and the server-rendered response carries the action's result
// (scripts/verify-backend-http.ts posts them exactly that way).

const VERIFY_DRAFT = 'auth:mfa-verify';

export function AdminMfaVerifyForm() {
  const t = useT('auth');
  const formRef = usePreservedForm(VERIFY_DRAFT);
  const [state, action, pending] = useActionState(verifyAdminMfa, {});
  return <form ref={formRef} action={action} onReset={() => clearDraft(VERIFY_DRAFT)} className="space-y-5">
    <label className="block text-sm text-zinc-700">{t('mfa.verify.code')}<input name="code" autoComplete="one-time-code" autoFocus required maxLength={64} className={fieldClass} /></label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending} className={buttonClass}>{pending ? t('mfa.verify.submitting') : t('mfa.verify.submit')}</button>
    <p className="text-xs text-zinc-500">{t('mfa.verify.help')}</p>
    <Link href="/auth/signin" onClick={() => clearDraft(VERIFY_DRAFT)} className="block text-sm text-zinc-600 underline">{t('mfa.restart')}</Link>
  </form>;
}

/**
 * A LANGUAGE SWITCH remounts this form and resets both action states. The one-time
 * values the actions returned (setup key, recovery codes) are therefore mirrored
 * into the in-memory draft store (i18n/draft-store.ts, never the URL or browser
 * storage) and read back on the remount, so the key is not re-issued and the
 * recovery codes stay on screen in the new language. Leaving via the buttons
 * below (or signing out) drops them.
 */
const SETUP_DRAFT = 'auth:mfa-setup';
const SETUP_KEYS = [`${SETUP_DRAFT}:password`, `${SETUP_DRAFT}:secret`, `${SETUP_DRAFT}:code`, `${SETUP_DRAFT}:recovery`] as const;
const clearSetupDrafts = () => SETUP_KEYS.forEach(clearDraft);

type Enrollment = { secret: string; uri: string };

export function AdminMfaSetupForm({ requiresPassword, enrolled = false }: { requiresPassword: boolean; enrolled?: boolean }) {
  const t = useT('auth');
  const pathname = usePathname() ?? '/';
  const startFormRef = usePreservedForm(`${SETUP_DRAFT}:password`);
  const [setup, start, starting] = useActionState(beginMfaEnrollment, {});
  const [finish, confirm, confirming] = useActionState(finishMfaEnrollment, {});
  // Restored only right after a language switch on this page; null otherwise.
  const [restoredEnrollment] = useDraftState<Enrollment | null>(`${SETUP_DRAFT}:secret`, null);
  const [restoredRecovery] = useDraftState<string[] | null>(`${SETUP_DRAFT}:recovery`, null);
  const [code, setCode] = useDraftState(`${SETUP_DRAFT}:code`, '');

  const recoveryCodes = finish.recoveryCodes ?? restoredRecovery;
  const enrollment: Enrollment | null = setup.secret && setup.uri ? { secret: setup.secret, uri: setup.uri } : restoredEnrollment;
  const secret = enrollment?.secret;
  const uri = enrollment?.uri;

  useEffect(() => {
    if (recoveryCodes) {
      saveDraft(`${SETUP_DRAFT}:recovery`, pathname, recoveryCodes);
      clearDraft(`${SETUP_DRAFT}:secret`);
      clearDraft(`${SETUP_DRAFT}:code`);
    } else if (secret && uri) {
      saveDraft(`${SETUP_DRAFT}:secret`, pathname, { secret, uri });
      clearDraft(`${SETUP_DRAFT}:password`);
    }
  }, [recoveryCodes, secret, uri, pathname]);

  if (recoveryCodes) return <div className="space-y-5">
    <p className="font-medium text-zinc-900">{t('mfa.setup.savedTitle')}</p>
    <p className="text-sm text-zinc-600">{t('mfa.setup.savedBody')}</p>
    <ul className="space-y-2 rounded border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-900">{recoveryCodes.map((recoveryCode) => <li key={recoveryCode}>{recoveryCode}</li>)}</ul>
    <Link href="/admin" onClick={clearSetupDrafts} className={`${buttonClass} block text-center`}>{t('mfa.setup.savedContinue')}</Link>
  </div>;
  if (enrolled) return <div className="space-y-5">
    <p className="text-sm text-zinc-700">{t('mfa.setup.alreadyEnabled')}</p>
    <Link href="/admin" onClick={clearSetupDrafts} className={`${buttonClass} block text-center`}>{t('mfa.setup.continueToAdmin')}</Link>
  </div>;
  return <div className="space-y-6">
    {!enrollment ? <form ref={startFormRef} action={start} onReset={() => clearDraft(`${SETUP_DRAFT}:password`)} className="space-y-5">
      {requiresPassword && <label className="block text-sm text-zinc-700">{t('mfa.setup.currentPassword')}<input name="password" type="password" autoComplete="current-password" required maxLength={128} className={fieldClass} /></label>}
      <p className="text-sm text-zinc-600">{t('mfa.setup.intro')}</p>
      {setup.error && <p role="alert" className="text-sm text-red-700">{setup.error}</p>}
      <button disabled={starting} className={buttonClass}>{starting ? t('mfa.setup.starting') : t('mfa.setup.start')}</button>
    </form> : <>
      <p className="text-sm text-zinc-700">{t('mfa.setup.keyIntro')}</p>
      <code className="block break-all rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-900">{enrollment.secret}</code>
      <a href={enrollment.uri} className="block text-sm text-zinc-700 underline">{t('mfa.setup.openInApp')}</a>
      <form action={confirm} className="space-y-5">
        <label className="block text-sm text-zinc-700">{t('mfa.setup.code')}<input name="code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required className={fieldClass} /></label>
        {finish.error && <p role="alert" className="text-sm text-red-700">{finish.error}</p>}
        <button disabled={confirming} className={buttonClass}>{confirming ? t('mfa.setup.enabling') : t('mfa.setup.enable')}</button>
      </form>
    </>}
    <Link href="/auth/signin" onClick={clearSetupDrafts} className="block text-sm text-zinc-600 underline">{t('mfa.restart')}</Link>
  </div>;
}
