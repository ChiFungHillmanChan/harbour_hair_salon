import Link from 'next/link';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { toTelHref } from '@/app/lib/phone';

// A branded 404 so a renamed/old URL (e.g. a changed service slug that Google
// still indexes) lands a high-intent visitor on the salon rather than the stock
// unstyled Next.js page with no way back into the site.
export default async function NotFound() {
  const settings = await getSiteSettings();
  const phone = settings.phone.trim() || '07831 830898';

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-900 px-4">
      <div className="max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 mb-3">Harbour Hair Salon</p>
        <h1 className="text-3xl font-serif font-bold mb-3">Page not found</h1>
        <p className="text-zinc-600 mb-8">
          Sorry, we couldn&apos;t find that page. It may have moved. Try one of these instead:
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/services"
            className="bg-black text-white px-6 py-3 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-800 transition-colors"
          >
            View services
          </Link>
          <Link
            href="/book"
            className="border border-zinc-300 text-zinc-900 px-6 py-3 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-100 transition-colors"
          >
            Book online
          </Link>
        </div>
        <p className="text-sm text-zinc-500 mt-8">
          Or call us at{' '}
          <a href={toTelHref(phone)} className="underline font-medium text-zinc-700">
            {phone}
          </a>
        </p>
      </div>
    </div>
  );
}
