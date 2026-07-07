import type { Metadata } from 'next';
import Link from 'next/link';
import { getSiteSettings } from '@/app/services/site-settings-service';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Harbour Hair Salon handles booking, account and marketing data.',
  alternates: { canonical: '/privacy' },
};

export default async function PrivacyPage() {
  const settings = await getSiteSettings();

  return (
    <div className="min-h-screen bg-white">
      <section className="bg-zinc-900 text-white py-20">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="w-12 h-[2px] bg-white/50 mb-6" />
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight">Privacy Policy</h1>
          <p className="mt-4 text-zinc-300">Last updated: 3 July 2026</p>
        </div>
      </section>

      <main className="container mx-auto px-4 py-14 max-w-3xl space-y-10 text-zinc-700 leading-7">
        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">Who We Are</h2>
          <p>
            Harbour Hair Salon operates from Upper Floor, Unit 15 Central Arcade, Central Rd,
            Leeds LS1 6DX. You can contact us by phone on {settings.phone} or through the details on
            our <Link href="/contact" className="text-zinc-900 underline">contact page</Link>.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">Information We Collect</h2>
          <p>
            We collect the information needed to run salon bookings and customer accounts, including
            name, email address, phone number, appointment details, service history, review content
            you submit, and marketing subscription preferences.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">How We Use It</h2>
          <p>
            We use your information to create and manage appointments, send booking confirmations,
            reminders and review requests, manage customer accounts, operate salon administration,
            prevent abuse, and send marketing emails only where you have subscribed.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">Service Providers</h2>
          <p>
            We use trusted providers to operate the website, database, email delivery, analytics and
            salon scheduling integrations. These providers process information only as needed to
            deliver those services.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">Marketing Emails</h2>
          <p>
            You can unsubscribe from marketing emails at any time using the unsubscribe link in our
            emails or by visiting <Link href="/unsubscribe" className="text-zinc-900 underline">our unsubscribe page</Link>.
            Appointment and account emails may still be sent where required to provide a service you requested.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">Your Rights</h2>
          <p>
            You can ask us to access, correct or delete personal information we hold about you,
            subject to legal and operational record-keeping requirements. Contact the salon to make a request.
          </p>
        </section>
      </main>
    </div>
  );
}
