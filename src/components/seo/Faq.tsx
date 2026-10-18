import type { ReactNode } from 'react';
import { jsonLdScript } from '@/app/lib/json-ld';
import { getT } from '@/i18n/server';

export type FaqItem = {
  question: string;
  answer: string;
  /** Set to 'en' when the page is in another language but this item is not translated yet. */
  lang?: string;
};

interface FaqProps {
  title?: string;
  intro?: ReactNode;
  items: FaqItem[];
  className?: string;
}

export async function Faq({ title, intro, items, className = '' }: FaqProps) {
  const heading = title ?? (await getT('home'))('faq.defaultTitle');
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <section className={`container mx-auto px-4 py-20 max-w-3xl ${className}`.trim()}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(schema) }}
      />
      <div className="text-center mb-6 md:mb-12">
        <div className="w-12 h-px bg-zinc-300 mx-auto mb-4 md:mb-6" />
        <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
          {heading}
        </h2>
        {intro && (
          <p className="mt-3 md:mt-4 text-sm sm:text-base text-zinc-600 leading-relaxed">{intro}</p>
        )}
      </div>

      <div className="divide-y divide-zinc-200 border-y border-zinc-200">
        {items.map((item, i) => (
          <details
            key={i}
            lang={item.lang}
            className="group [&[open]>summary>span:last-child]:rotate-45"
          >
            <summary className="flex min-h-11 cursor-pointer items-start justify-between gap-3 py-4 md:gap-6 md:py-5 text-left list-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
              <h3 className="min-w-0 break-words text-lg md:text-xl font-serif text-zinc-900 leading-snug">
                {item.question}
              </h3>
              <span
                aria-hidden="true"
                className="mt-1 inline-block text-2xl text-zinc-400 transition-transform duration-300 ease-apple shrink-0"
              >
                +
              </span>
            </summary>
            <p className="pb-4 md:pb-5 text-sm sm:text-base text-zinc-600 leading-relaxed break-words sm:pr-10">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
