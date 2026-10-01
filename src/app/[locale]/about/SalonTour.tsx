'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/config';

type SalonTourProps = {
  locale: Locale;
  title: string;
  previewAlt: string;
  startLabel: string;
  closeLabel: string;
  controls: string;
};

/** No WebGL scene is requested until the visitor chooses to open the tour. */
export default function SalonTour({ locale, title, previewAlt, startLabel, closeLabel, controls }: SalonTourProps) {
  const [isOpen, setIsOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!isOpen || !frame || typeof IntersectionObserver === 'undefined') return;

    let visible = true;
    const notifyVisibility = () => {
      frame.contentWindow?.postMessage({ type: 'harbour:visibility', visible }, window.location.origin);
    };
    frame.addEventListener('load', notifyVisibility);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      notifyVisibility();
    });
    observer.observe(frame);

    return () => {
      observer.disconnect();
      frame.removeEventListener('load', notifyVisibility);
    };
  }, [isOpen]);

  return (
    <div className="overflow-hidden border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6">
        <p id="tour-controls" className="max-w-xl text-sm leading-relaxed text-zinc-600">{controls}</p>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls="salon-tour-view"
          onClick={() => setIsOpen((open) => !open)}
          className="min-h-11 shrink-0 bg-black px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
        >
          {isOpen ? closeLabel : startLabel}
        </button>
      </div>
      <div id="salon-tour-view" className="relative h-[min(65svh,32rem)] min-h-80 bg-zinc-100 sm:min-h-96">
        {isOpen ? (
          <iframe
            ref={frameRef}
            src={`/harbour-hair-3d.html?lang=${locale}`}
            title={title}
            aria-describedby="tour-controls"
            className="block h-full w-full border-0"
          />
        ) : (
          <Image
            src="/images/gallery/salon-1.webp"
            alt={previewAlt}
            fill
            sizes="(max-width: 1280px) 100vw, 1152px"
            className="object-cover"
          />
        )}
      </div>
    </div>
  );
}
