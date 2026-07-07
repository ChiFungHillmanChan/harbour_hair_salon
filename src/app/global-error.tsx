'use client';
import './globals.css';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-serif font-bold mb-3">Something went wrong</h1>
            <p className="text-zinc-600 mb-6">Please try again.</p>
            <button
              onClick={reset}
              className="bg-black text-white px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-800 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
