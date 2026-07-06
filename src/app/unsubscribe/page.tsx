import type { Metadata } from 'next';
import Link from 'next/link';
import { UnsubscribeForm } from '@/components/newsletter/UnsubscribeForm';

export const metadata: Metadata = {
  title: 'Unsubscribe from Marketing Emails',
  description: 'Unsubscribe from Harbour Hair Salon marketing emails.',
  alternates: { canonical: '/unsubscribe' },
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return (
    <div className="min-h-screen bg-zinc-50 py-16 px-4">
      <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="font-serif text-3xl text-zinc-900 mb-3">Unsubscribe</h1>
        <p className="text-sm leading-6 text-zinc-600 mb-8">
          Enter your email address and we will remove it from Harbour Hair Salon marketing emails.
          Booking confirmations, appointment changes and service emails may still be sent when needed.
        </p>
        <UnsubscribeForm />
        <p className="mt-6 text-sm text-zinc-500">
          Need help? <Link href="/contact" className="text-zinc-900 underline">Contact the salon</Link>.
        </p>
      </div>
    </div>
  );
}
