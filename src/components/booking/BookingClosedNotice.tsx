import Link from '@/i18n/link';
import { rich } from '@/i18n/rich';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';
import type { MarketplaceLink } from '@/app/services/marketplace-channels';

/**
 * How to book while online booking is closed. Both come from SiteSettings, so
 * the salon can change them in Admin -> Settings without a redeploy —
 * including removing a marketplace entirely.
 */
export type BookingClosedContact = { phone: string; marketplaces: MarketplaceLink[] };

/**
 * What a customer is told whenever online booking is closed: on /book itself,
 * and inside the booking wizard when booking closes while it is open (the
 * nightly pause, or staff switching it off) — one component, so the two can
 * never say different things. It has no hooks and no 'use client': the server
 * page passes its translator, the wizard passes its own.
 */
export function BookingClosedNotice({ t, phone, marketplaces, heading: Heading = 'h1' }: BookingClosedContact & {
  t: Translate<Messages['booking']>;
  /** h1 as the page itself; h2 inside the wizard, under the page's own h1. */
  heading?: 'h1' | 'h2';
}) {
  return (
    <>
      <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
      {/* Every "Book Now" on the site lands here, so this has to read like the
          salon's booking page — not like an apology for one that is missing.
          It used to say "Online booking is on its way", which told every
          visitor on the landing page that the site was unfinished, when in
          fact both routes below take a real booking today. Copy stays
          marketplace-agnostic: the names come from settings, so clearing a URL
          in the admin panel removes it here. */}
      <Heading className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4 tracking-tight">
        {marketplaces.length > 0 ? t('closed.titleWithPartners') : t('closed.titlePhoneOnly')}
      </Heading>
      <p className="text-zinc-600 leading-relaxed mb-8">
        {marketplaces.length > 0 ? t('closed.bodyWithPartners') : t('closed.bodyPhoneOnly')}
      </p>

      {/* Phone first and equally prominent: a phone booking costs the salon
          no marketplace commission, so it should never look like a fallback. */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href={`tel:${phone.replace(/\s+/g, '')}`}
          className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-md font-medium hover:bg-zinc-700 transition-colors"
        >
          {t('closed.call', { phone })}
        </a>
        {marketplaces.map((m) => (
          <a
            key={m.name}
            href={m.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block border border-zinc-900 text-zinc-900 px-8 py-3 rounded-md font-medium hover:bg-zinc-100 transition-colors"
          >
            {t('closed.bookOn', { name: m.name })}
          </a>
        ))}
      </div>

      {marketplaces.length === 0 && (
        <p className="mt-5 text-sm text-zinc-500 leading-relaxed">
          {t('closed.phoneHours')}
        </p>
      )}

      <p className="mt-6 text-sm text-zinc-500">
        {rich(t('closed.alreadyBooked'), {
          link: (text) => <Link href="/appointments" className="underline hover:text-zinc-900">{text}</Link>,
        })}
      </p>
    </>
  );
}
