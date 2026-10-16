'use client';

import { clearAllDrafts } from '@/i18n/draft-store';
import type { Locale } from '@/i18n/config';

/** `app/api/auth/signout/route.ts`: ends every session and clears site data. */
export const SIGN_OUT_PATH = '/api/auth/signout';

/**
 * What this tab holds for the account, cleared before the sign-out request
 * leaves: unsaved drafts (memory) and web storage, for browsers that ignore the
 * route's Clear-Site-Data header.
 */
export function clearLocalAccountState() {
  clearAllDrafts();
  for (const area of ['localStorage', 'sessionStorage'] as const) {
    try {
      window[area].clear();
    } catch {
      // Storage blocked by the browser: nothing could have been kept there.
    }
  }
}

/** Signs out through a real form POST, so the whole page (and its router cache) is replaced. */
export function submitSignOut(locale: Locale) {
  clearLocalAccountState();
  const form = document.createElement('form');
  form.method = 'post';
  form.action = SIGN_OUT_PATH;
  form.hidden = true;
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'locale';
  field.value = locale;
  form.append(field);
  document.body.append(form);
  form.submit();
}
