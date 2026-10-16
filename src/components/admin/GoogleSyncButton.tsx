'use client';

import { useFormStatus } from 'react-dom';

/**
 * "Sync now": disabled while the action runs (it can take a minute), so a
 * second click cannot start a second sync. Words come from the server component.
 */
export function GoogleSyncButton({ label, busy, disabled }: { label: string; busy: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button disabled={disabled || pending} aria-busy={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50">{pending ? busy : label}</button>;
}
