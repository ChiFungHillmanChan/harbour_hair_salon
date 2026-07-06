import type { Metadata } from 'next';
import { jsonLdScript } from '@/app/lib/json-ld';
import Link from 'next/link';
import Image from 'next/image';
import { getPublishedPosts } from '@/app/services/blog-service';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';

export const metadata: Metadata = {
  title: 'The Harbour Journal',
  description:
    'Hair care guides, styling tips and advice from the Hong Kong trained stylists at Harbour Hair Salon, Leeds city centre.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'The Harbour Journal | Harbour Hair Salon Leeds',
    description:
      'Guides, tips and stylist advice from Harbour Hair Salon in Leeds.',
  },
};

export const revalidate = 3600;

function formatDate(date: Date) {
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function BlogIndexPage() {
  const posts = await getPublishedPosts();

  const blogSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'The Harbour Journal',
    description:
      'Hair care guides, styling tips and advice from Harbour Hair Salon, Leeds.',
    url: `${BASE_URL}/blog`,
    publisher: {
      '@type': 'HairSalon',
      name: 'Harbour Hair Salon',
      url: BASE_URL,
    },
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${BASE_URL}/blog/${p.slug}`,
      datePublished: p.publishedAt.toISOString(),
      author: { '@type': 'Organization', name: p.author },
    })),
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Journal', item: `${BASE_URL}/blog` },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(blogSchema) }}
      />

      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/services-hero.webp"
            alt="Harbour Hair Salon journal"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-30"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            The Harbour <span className="text-zinc-400">Journal</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Hair care guides, styling tips and honest advice from our Hong Kong trained stylists in Leeds.
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-20 max-w-5xl">
        {posts.length === 0 ? (
          <p className="text-center text-zinc-500 py-20">No posts yet. Check back soon.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-10">
            {posts.map((post) => (
              <article
                key={post.slug}
                className="group bg-white border border-zinc-200 rounded-2xl overflow-hidden hover:border-zinc-900 hover:shadow-xl transition-all"
              >
                <Link href={`/blog/${post.slug}`} className="block">
                  <div className="relative aspect-[16/9] overflow-hidden bg-zinc-100">
                    <Image
                      src={post.coverImage}
                      alt={post.coverAlt}
                      fill
                      className="object-cover opacity-70 group-hover:opacity-90 group-hover:scale-105 transition-all duration-700"
                    />
                  </div>
                  <div className="p-7">
                    <div className="flex items-center gap-3 text-xs text-zinc-500 uppercase tracking-[0.15em] mb-3">
                      <time dateTime={post.publishedAt.toISOString()}>{formatDate(post.publishedAt)}</time>
                      <span aria-hidden="true">·</span>
                      <span>{post.readingTime} min read</span>
                    </div>
                    <h2 className="text-2xl font-serif text-zinc-900 mb-3 leading-tight group-hover:text-zinc-700 transition-colors">
                      {post.title}
                    </h2>
                    <p className="text-zinc-600 font-light leading-relaxed">{post.excerpt}</p>
                    <span className="inline-flex items-center gap-2 mt-5 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-zinc-600 transition-colors">
                      Read article
                      <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
