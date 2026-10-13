'use client';

import { useState } from 'react';

type Props = {
  src: string;
  title: string;
  /** Why the map isn't loaded yet (it is Google's content and sets Google's cookies). */
  notice: string;
  showLabel: string;
  openLabel: string;
  openHref: string;
};

/**
 * Click-to-load Google map. The embed sends the visitor's IP to Google and
 * lets Google set cookies, so it only loads once the visitor asks for it
 * (UK GDPR / PECR); until then the box offers a plain link to Google Maps.
 * Strings arrive translated from the server page.
 */
export function ConsentMap({ src, title, notice, showLabel, openLabel, openHref }: Props) {
  const [shown, setShown] = useState(false);
  if (shown) {
    return (
      <iframe
        src={src}
        width="100%"
        height="100%"
        style={{ border: 0, minHeight: '500px' }}
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        title={title}
      />
    );
  }
  return (
    <div className="flex h-full min-h-[500px] flex-col items-center justify-center gap-5 p-8 text-center">
      <p className="max-w-sm text-sm leading-6 text-zinc-600">{notice}</p>
      <button
        type="button"
        onClick={() => setShown(true)}
        className="min-h-11 bg-zinc-900 px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        {showLabel}
      </button>
      <a href={openHref} target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-900 underline hover:text-zinc-600">
        {openLabel}
      </a>
    </div>
  );
}
