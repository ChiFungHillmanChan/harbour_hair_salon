'use client';
import './globals.css';
import { splitLocalePath } from '@/i18n/paths';

// Replaces the root layout when it fails, so no dictionary or provider is
// available: the language comes from the URL and the two strings are inline.
const COPY = {
  'en-GB': { title: 'Something went wrong', body: 'Please try again.', retry: 'Try again' },
  'zh-HK': { title: '發生錯誤', body: '請再試一次。', retry: '再試一次' },
} as const;

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = typeof window === 'undefined' ? 'en-GB' : splitLocalePath(window.location.pathname).locale;
  const copy = COPY[locale];
  return (
    <html lang={locale}>
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-serif font-bold mb-3">{copy.title}</h1>
            <p className="text-zinc-600 mb-6">{copy.body}</p>
            <button
              onClick={reset}
              className="bg-black text-white px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-800 transition-colors"
            >
              {copy.retry}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
