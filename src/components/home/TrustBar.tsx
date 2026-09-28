import type { ReactNode } from 'react';
import { getT } from '@/i18n/server';

/**
 * Honest credibility strip shown directly under the hero. Unlike SocialProofBar
 * (which only renders once there are approved reviews), this always surfaces the
 * salon's genuine, verifiable differentiators so the top of the page never lacks
 * a trust signal. When reviews start arriving, SocialProofBar appears alongside.
 *
 * Everything here is factual — no fabricated ratings or testimonials.
 */
const ICON = {
  scissors: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  sparkle: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M12 2.5l2.2 5.9 5.9 2.2-5.9 2.2L12 18.7l-2.2-5.9L3.9 10.6l5.9-2.2z" />
    </svg>
  ),
};

// `label` names the pillar's text in the `home.trustBar` dictionary.
type Pillar = { icon: ReactNode; label: 'hongKongTrained' | 'expertServices' | 'location' | 'openDaily' };

const PILLARS: Pillar[] = [
  { icon: ICON.scissors, label: 'hongKongTrained' },
  { icon: ICON.sparkle, label: 'expertServices' },
  { icon: ICON.pin, label: 'location' },
  { icon: ICON.clock, label: 'openDaily' },
];

export async function TrustBar({
  treatwellUrl,
  googleBusinessUrl,
}: {
  treatwellUrl?: string | null;
  googleBusinessUrl?: string | null;
}) {
  const t = await getT('home');
  return (
    <section className="bg-white border-b border-zinc-100" aria-label={t('trustBar.label')}>
      <div className="container mx-auto px-4 py-5">
        <ul className="flex flex-wrap items-center justify-center gap-x-7 md:gap-x-10 gap-y-3 text-sm text-zinc-600">
          {PILLARS.map((p) => (
            <li key={p.label} className="inline-flex items-center gap-2">
              <span className="text-zinc-900">{p.icon}</span>
              <span className="tracking-wide">{t(`trustBar.${p.label}`)}</span>
            </li>
          ))}
        </ul>

        {(treatwellUrl || googleBusinessUrl) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.18em]">
            {treatwellUrl && (
              <a
                href={treatwellUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-zinc-900 hover:text-zinc-600 transition-colors"
              >
                {t('trustBar.bookOnTreatwell')}
              </a>
            )}
            {googleBusinessUrl && (
              <a
                href={googleBusinessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-zinc-900 transition-colors"
              >
                {t('trustBar.findOnGoogle')}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
