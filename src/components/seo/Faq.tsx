import type { ReactNode } from 'react';
import { jsonLdScript } from '@/app/lib/json-ld';

export type FaqItem = {
  question: string;
  answer: string;
};

interface FaqProps {
  title?: string;
  intro?: ReactNode;
  items: FaqItem[];
  className?: string;
}

export function Faq({ title = 'Frequently Asked Questions', intro, items, className = '' }: FaqProps) {
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
      <div className="text-center mb-12">
        <div className="w-12 h-px bg-zinc-300 mx-auto mb-6" />
        <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
          {title}
        </h2>
        {intro && (
          <p className="mt-4 text-zinc-600 font-light leading-relaxed">{intro}</p>
        )}
      </div>

      <div className="divide-y divide-zinc-200 border-y border-zinc-200">
        {items.map((item, i) => (
          <details
            key={i}
            className="group py-5 [&[open]>summary>span:last-child]:rotate-45"
          >
            <summary className="flex cursor-pointer items-start justify-between gap-6 text-left list-none">
              <h3 className="text-lg md:text-xl font-serif text-zinc-900 leading-snug">
                {item.question}
              </h3>
              <span
                aria-hidden="true"
                className="mt-1 inline-block text-2xl text-zinc-400 transition-transform duration-300 ease-apple shrink-0"
              >
                +
              </span>
            </summary>
            <p className="mt-4 text-zinc-600 font-light leading-relaxed pr-10">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
