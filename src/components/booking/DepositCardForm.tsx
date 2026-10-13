'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import { attachDepositCard, mountSquareCard, type DepositCard, type SquarePublicConfig } from './square-web-payments';

/**
 * Square's card field for the deposit. The card number never touches this
 * page or the salon's server: Square's iframe collects it, and the wizard
 * asks the mounted field for a single-use token when the customer confirms.
 * `onCardChange` receives the field once it is ready, and null when it goes
 * (unmounted, or the form is shown again for another configuration).
 */
export function DepositCardForm({ square, phone, onCardChange, mount = mountSquareCard }: {
  square: SquarePublicConfig;
  /** The salon's phone, for when the form cannot load. */
  phone: string;
  onCardChange: (card: DepositCard | null) => void;
  /** Tests replace Square's SDK. */
  mount?: (config: SquarePublicConfig, container: HTMLElement) => Promise<DepositCard>;
}) {
  const t = useT('booking');
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const { applicationId, locationId, environment } = square;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    return attachDepositCard({
      config: { applicationId, locationId, environment },
      element,
      mount,
      onReady: (card) => {
        setState('ready');
        onCardChange(card);
      },
      onFailed: () => setState('failed'),
      onGone: () => onCardChange(null),
    });
  }, [applicationId, locationId, environment, mount, onCardChange]);

  return (
    <fieldset className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6">
      <legend className="px-1 text-sm font-semibold text-zinc-900">{t('deposit.cardLegend')}</legend>
      {state === 'loading' && (
        <p className="mb-3 flex items-center gap-2 text-sm text-zinc-500" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" aria-hidden="true" />
          {t('deposit.cardLoading')}
        </p>
      )}
      {state === 'failed' && (
        <p className="text-sm text-zinc-800" role="alert">{t('deposit.cardLoadFailed', { phone })}</p>
      )}
      {/* Square attaches its iframe here; it stays in the page so the effect always finds it. */}
      <div ref={container} className={state === 'failed' ? 'hidden' : 'min-h-[5.5rem]'} />
      <p className="mt-3 text-xs text-zinc-500 leading-relaxed">{t('deposit.cardSecure')}</p>
    </fieldset>
  );
}
