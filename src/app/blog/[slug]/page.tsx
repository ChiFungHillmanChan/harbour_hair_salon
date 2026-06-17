import type { Metadata } from 'next';
import { jsonLdScript } from '@/app/lib/json-ld';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  getPublishedPosts,
  getPublishedPostBySlug,
  type BlogSection,
} from '@/app/services/blog-service';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';

export const revalidate = 3600;

export async function generateStaticParams() {
  const posts = await getPublishedPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: `${post.title} | Harbour Hair Salon Leeds`,
      description: post.description,
      type: 'article',
      publishedTime: post.publishedAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.author],
    },
  };
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
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
            <span className="shrink-0 mt-2.5 w-1.5 h-1.5 rounded-full bg-accent" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (section.type === 'quote') {
    return (
      <blockquote className="border-l-2 border-accent pl-6 my-8 italic text-zinc-800 text-xl font-serif">
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
  const post = await getPublishedPostBySlug(slug);
  if (!post) notFound();

  const relatedResults = await Promise.all(
    (post.relatedSlugs ?? []).map((s) => getPublishedPostBySlug(s))
  );
  const related = relatedResults.filter((p): p is NonNullable<typeof p> => Boolean(p));

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
      '@id': `${BASE_URL}/blog/${post.slug}`,
    },
    keywords: post.tags.join(', '),
    articleSection: post.tags[0] ?? 'hair care',
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
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Journal', item: `${BASE_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: `${BASE_URL}/blog/${post.slug}` },
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
            fill
            priority
            className="object-cover opacity-30"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 max-w-3xl text-center">
          <nav aria-label="Breadcrumb" className="mb-6 text-xs text-zinc-400 uppercase tracking-[0.2em]">
            <ol className="flex items-center justify-center gap-2">
              <li><Link href="/" className="hover:text-accent">Home</Link></li>
              <li aria-hidden="true">·</li>
              <li><Link href="/blog" className="hover:text-accent">Journal</Link></li>
            </ol>
          </nav>
          <div className="w-12 h-[2px] bg-accent mx-auto mb-6" />
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif mb-6 tracking-tight leading-[1.1]">
            {post.title}
          </h1>
          <div className="flex items-center justify-center gap-3 text-xs text-zinc-400 uppercase tracking-[0.15em]">
            <time dateTime={post.publishedAt.toISOString()}>{formatDate(post.publishedAt)}</time>
            <span aria-hidden="true">·</span>
            <span>{post.readingTime} min read</span>
            <span aria-hidden="true">·</span>
            <span>{post.author}</span>
          </div>
        </div>
      </header>

      {/* Lede */}
      <section className="container mx-auto px-4 py-16 max-w-3xl">
        <p className="text-xl md:text-2xl font-serif text-zinc-800 italic leading-relaxed mb-12 border-l-2 border-accent pl-6">
          {post.lede}
        </p>

        {/* Body */}
        <div>
          {post.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </div>

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="mt-16 pt-8 border-t border-zinc-200">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 mb-3">Filed under</p>
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
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 mb-2">Written by</p>
          <p className="font-medium text-zinc-900">{post.author}</p>
          <p className="text-sm text-zinc-500 mt-1">{post.authorRole}</p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-zinc-900 text-white py-20">
        <div className="container mx-auto px-4 max-w-3xl text-center">
          <div className="w-12 h-[2px] bg-accent mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-serif mb-4 tracking-tight">
            Ready for your appointment?
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto font-light leading-relaxed mb-8">
            Book online in under a minute. Expert cuts, colours, perms and treatments in the heart of Leeds.
          </p>
          <Link
            href="/book"
            className="inline-block bg-accent text-black px-12 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-all"
          >
            Book Appointment
          </Link>
        </div>
      </section>

      {/* Related posts */}
      {related.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-5xl">
          <div className="text-center mb-12">
            <div className="w-12 h-[2px] bg-accent mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
              Keep reading
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {related.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group block bg-white border border-zinc-200 rounded-2xl p-8 hover:border-zinc-900 hover:shadow-lg transition-all"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-accent mb-2">Journal</p>
                <h3 className="text-2xl font-serif text-zinc-900 mb-3 group-hover:text-zinc-700 transition-colors">
                  {p.title}
                </h3>
                <p className="text-zinc-600 font-light leading-relaxed">{p.excerpt}</p>
                <span className="inline-flex items-center gap-2 mt-4 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-accent transition-colors">
                  Read article
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
