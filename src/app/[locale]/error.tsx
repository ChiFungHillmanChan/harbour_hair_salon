'use client';

import { useT } from '@/i18n/client';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT('common');
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-900 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-serif font-bold mb-3">{t('errors.somethingWrong')}</h1>
        <p className="text-zinc-600 mb-6">
          {t('errors.unexpected')}
        </p>
        <button
          onClick={reset}
          className="bg-black text-white px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-800 transition-colors"
        >
          {t('actions.tryAgain')}
        </button>
      </div>
    </div>
  );
}
