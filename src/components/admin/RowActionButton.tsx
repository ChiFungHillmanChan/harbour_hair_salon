'use client';

import { useActionState } from 'react';

// Matches the { error?, success? } convention of the offer/discount actions
// in src/app/actions/admin.ts.
export type RowActionResult = { error?: string; success?: boolean };

interface RowActionButtonProps {
  /** A pre-bound server action, e.g. `deleteOffer.bind(null, offer.id)`. */
  action: () => Promise<RowActionResult>;
  label: string;
  pendingLabel: string;
  buttonClassName: string;
  /**
   * When set, shows a `window.confirm` prompt before the action runs;
   * cancelling aborts the submission. Intended for destructive actions
   * (delete) — not for reversible toggles like activate/deactivate.
   */
  confirmMessage?: string;
}

/**
 * Per-row submit button for admin list pages (offers, discounts). Wraps a
 * bound server action in useActionState so a failure (expired session,
 * database error) surfaces next to the row it belongs to instead of
 * silently no-opping. Success needs no message: revalidation visibly
 * updates the row (label flips / row disappears).
 */
export function RowActionButton({ action, label, pendingLabel, buttonClassName, confirmMessage }: RowActionButtonProps) {
  const [state, formAction, pending] = useActionState<RowActionResult, FormData>(
    async () => action(),
    {}
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" disabled={pending} className={`${buttonClassName} disabled:opacity-50`}>
        {pending ? pendingLabel : label}
      </button>
      {state.error && (
        <p className="text-xs text-red-600 mt-1 whitespace-normal" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
