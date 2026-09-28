import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { jsonLdScript } from '@/app/lib/json-ld';
import Link from '@/i18n/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  getPublishedPostSlugs,
  getRelatedPublishedPosts,
  getPublishedPostBySlug,
  type BlogSection,
} from '@/app/services/blog-service';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';
import { formatSalon } from '@/i18n/dates';

export const revalidate = 3600;

export async function generateStaticParams() {
  return getPublishedPostSlugs();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const [post, t] = await Promise.all([getPublishedPostBySlug(slug, locale), getT('blog')]);
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: alternatesFor(locale, `/blog/${post.slug}`),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('post.ogTitle', { title: post.title }),
      description: post.description,
      type: 'article',
      publishedTime: post.publishedAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.author],
    },
  };
}

function Section({ section }: { section: BlogSection }) {
  if (section.type === 'heading') {
    const Tag = section.level === 2 ? 'h2' : 'h3';
    const className =
      section.level === 2
        ? 'text-3xl md:text-4xl font-serif text-zinc-900 mt-12 mb-4 tracking-tight'
        : 'text-2xl font-serif text-zinc-900 mt-10 mb-3';
    return <Tag className={className}>{section.text}</Tag>;
  }
  if (section.type === 'paragraph') {
    return (
      <p className="text-lg text-zinc-700 leading-relaxed font-light mb-6">
        {section.text}
      </p>
    );
  }
  if (section.type === 'list') {
    return (
      <ul className="space-y-3 mb-8 pl-1">
        {section.items.map((item, i) => (
          <li key={i} className="flex gap-4 items-start text-zinc-700 font-light leading-relaxed">
            <span className="shrink-0 mt-2.5 w-1.5 h-1.5 rounded-full bg-zinc-900" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (section.type === 'quote') {
    return (
      <blockquote className="border-l-2 border-zinc-900 pl-6 my-8 italic text-zinc-800 text-xl font-serif">
        <p>&ldquo;{section.text}&rdquo;</p>
        {section.attribution && (
          <footer className="mt-3 text-sm text-zinc-500 not-italic font-sans">
            — {section.attribution}
          </footer>
        )}
      </blockquote>
    );
  }
  return null;
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const [post, t] = await Promise.all([getPublishedPostBySlug(slug, locale), getT('blog')]);
  if (!post) notFound();

  const related = await getRelatedPublishedPosts(post.relatedSlugs.filter((relatedSlug) => relatedSlug !== slug), locale);
  const url = (path: string) => `${BASE_URL}${localizeHref(locale, path) === '/' ? '' : localizeHref(locale, path)}`;
  // An article without a published translation is shown, whole, in English.
  const fallbackLang = (translated: boolean) => (locale === 'en-GB' || translated ? undefined : 'en');
  const lang = fallbackLang(post.translated);
  const publishedOn = formatSalon(locale, post.publishedAt, { year: 'numeric', month: 'long', day: 'numeric' });

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    image: `${BASE_URL}${post.coverImage}`,
    datePublished: post.publishedAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: {
      '@type': 'Organization',
      name: post.author,
      url: BASE_URL,
    },
    publisher: {
      '@type': 'HairSalon',
      name: 'Harbour Hair Salon',
      url: BASE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/images/favicon.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url(`/blog/${post.slug}`),
    },
    keywords: post.tags.join(', '),
    articleSection: post.tags[0] ?? t('post.defaultSection'),
    wordCount: post.sections.reduce(
      (sum, s) =>
        sum +
        (s.type === 'paragraph' ? s.text.split(/\s+/).length : 0) +
        (s.type === 'heading' ? s.text.split(/\s+/).length : 0) +
        (s.type === 'list' ? s.items.join(' ').split(/\s+/).length : 0),
      0
    ),
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: url('/') },
      { '@type': 'ListItem', position: 2, name: t('breadcrumb.journal'), item: url('/blog') },
      { '@type': 'ListItem', position: 3, name: post.title, item: url(`/blog/${post.slug}`) },
    ],
  };

  return (
    <article className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(articleSchema) }}
      />

      {/* Hero */}
      <header className="relative py-24 md:py-32 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src={post.coverImage}
            alt={post.coverAlt}
            lang={lang}
            fill
            priority
            className="object-cover opacity-30"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 max-w-3xl text-center">
          <nav aria-label={t('breadcrumb.label')} className="mb-6 text-xs text-zinc-400 uppercase tracking-[0.2em]">
            <ol className="flex items-center justify-center gap-2">
              <li><Link href="/" className="hover:text-zinc-300">{t('breadcrumb.home')}</Link></li>
              <li aria-hidden="true">·</li>
              <li><Link href="/blog" className="hover:text-zinc-300">{t('breadcrumb.journal')}</Link></li>
            </ol>
          </nav>
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif mb-6 tracking-tight leading-[1.1]" lang={lang}>
            {post.title}
          </h1>
          <div className="flex items-center justify-center gap-3 text-xs text-zinc-400 uppercase tracking-[0.15em]">
            <time dateTime={post.publishedAt.toISOString()}>{publishedOn}</time>
            <span aria-hidden="true">·</span>
            <span>{t('readingTime', { count: post.readingTime })}</span>
            <span aria-hidden="true">·</span>
            <span>{post.author}</span>
          </div>
        </div>
      </header>

      {/* Lede */}
      <section className="container mx-auto px-4 py-16 max-w-3xl">
        <p className="text-xl md:text-2xl font-serif text-zinc-800 italic leading-relaxed mb-12 border-l-2 border-zinc-900 pl-6" lang={lang}>
          {post.lede}
        </p>

        {/* Body */}
        <div lang={lang}>
          {post.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </div>

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="mt-16 pt-8 border-t border-zinc-200">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 mb-3">{t('post.filedUnder')}</p>
            <div className="flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-3 py-1 text-xs uppercase tracking-wider text-zinc-600 bg-zinc-100 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Author bio */}
        <div className="mt-12 p-6 bg-zinc-50 border border-zinc-100 rounded-xl">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 mb-2">{t('post.writtenBy')}</p>
          <p className="font-medium text-zinc-900">{post.author}</p>
          <p className="text-sm text-zinc-500 mt-1" lang={lang}>{post.authorRole}</p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-zinc-900 text-white py-20">
        <div className="container mx-auto px-4 max-w-3xl text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-serif mb-4 tracking-tight">
            {t('post.ctaTitle')}
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto font-light leading-relaxed mb-8">
            {t('post.ctaBody')}
          </p>
          <Link
            href="/book"
            className="inline-block bg-white text-zinc-900 px-12 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all"
          >
            {t('post.ctaButton')}
          </Link>
        </div>
      </section>

      {/* Related posts */}
      {related.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-5xl">
          <div className="text-center mb-12">
            <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
              {t('post.keepReading')}
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {related.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group block bg-white border border-zinc-200 rounded-2xl p-8 hover:border-zinc-900 hover:shadow-lg transition-all"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">{t('post.journal')}</p>
                <h3 className="text-2xl font-serif text-zinc-900 mb-3 group-hover:text-zinc-700 transition-colors" lang={fallbackLang(p.translated)}>
                  {p.title}
                </h3>
                <p className="text-zinc-600 font-light leading-relaxed" lang={fallbackLang(p.translated)}>{p.excerpt}</p>
                <span className="inline-flex items-center gap-2 mt-4 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-zinc-600 transition-colors">
                  {t('readArticle')}
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
