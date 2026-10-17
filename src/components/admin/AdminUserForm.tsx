'use client';

import { useActionState, useEffect } from 'react';
import { createAdminUser, type AdminUserActionState } from '@/app/actions/admin';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

const DRAFT_KEY = 'admin-user-form';

export function AdminUserForm() {
  const t = useT('adminOps');
  // Name and email survive a language switch (memory only); the password is
  // never kept and has to be typed again.
  const formRef = usePreservedForm(DRAFT_KEY);
  const [state, formAction, pending] = useActionState<AdminUserActionState, FormData>(
    createAdminUser,
    {}
  );

  // Only clear the fields once the admin actually exists — a rejected email or
  // too-short password keeps what was typed so it can be corrected.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      clearDraft(DRAFT_KEY);
    }
  }, [state, formRef]);

  return (
    <details className="mb-4 rounded-lg border border-zinc-200 bg-white p-3 sm:mb-8 sm:p-6">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-zinc-900">{t('users.form.title')}</summary>
      <form ref={formRef} action={formAction} className="mt-4 space-y-4">
        {state.error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm"
            role="alert"
          >
            {state.error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label htmlFor="admin-user-name" className="block text-sm font-medium text-zinc-700 mb-1">{t('users.form.name')}</label>
            <input
              id="admin-user-name"
              type="text"
              name="name"
              required
              placeholder={t('users.form.namePlaceholder')}
              className="min-h-11 min-w-0 w-full px-3 py-2 text-base sm:text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="admin-user-email" className="block text-sm font-medium text-zinc-700 mb-1">{t('users.form.email')}</label>
            <input
              id="admin-user-email"
              type="email"
              name="email"
              required
              placeholder={t('users.form.emailPlaceholder')}
              className="min-h-11 min-w-0 w-full px-3 py-2 text-base sm:text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="admin-user-password" className="block text-sm font-medium text-zinc-700 mb-1">{t('users.form.password')}</label>
            <input
              id="admin-user-password"
              type="password"
              name="password"
              required
              minLength={8}
              data-no-preserve
              autoComplete="new-password"
              placeholder={t('users.form.passwordPlaceholder')}
              className="min-h-11 min-w-0 w-full px-3 py-2 text-base sm:text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
        </div>
        <div className="flex flex-wrap justify-end items-center gap-3">
          {state.success && <span className="text-xs text-emerald-600" role="status">✓ {t('users.form.created')}</span>}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 w-full sm:w-auto bg-zinc-900 text-white px-6 py-2 rounded-md hover:bg-zinc-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {pending ? t('users.form.creating') : t('users.form.submit')}
          </button>
        </div>
      </form>
    </details>
  );
}
