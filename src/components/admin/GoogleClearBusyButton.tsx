'use client';

import type { MouseEvent } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * "Clear Google busy time and diary copy": asks first (it frees every hour blocked from
 * Google, on the website and in the Fresha busy feed), then stays disabled
 * while the action runs. Words come from the server component.
 */
export function GoogleClearBusyButton({ label, busy, confirm }: { label: string; busy: string; confirm: string }) {
  const { pending } = useFormStatus();
  const ask = (event: MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(confirm)) event.preventDefault();
  };
  return <button onClick={ask} disabled={pending} aria-busy={pending} className="rounded border border-zinc-900 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50">{pending ? busy : label}</button>;
}
