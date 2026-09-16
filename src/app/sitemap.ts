import type { MetadataRoute } from 'next';
import prisma from '@/app/lib/prisma';
import { slugify } from '@/app/stylists/slug';
import { SITE_URL } from '@/app/lib/site-url';

export const revalidate = 3600;

function latestDate(...dates: (Date | null | undefined)[]): Date | undefined {
  return dates.reduce<Date | undefined>((latest, date) =>
    date && (!latest || date > latest) ? date : latest, undefined);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Read only URL and modification fields. A failed read must fail regeneration;
  // publishing a successful partial sitemap would remove valid URLs from it.
  const [latestService, latestOffer, servicesByCategory, stylists, blogPosts,
    categoryContents, settings, reviews, faqs] = await Promise.all([
    prisma.service.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.offer.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.service.groupBy({ by: ['category'], _max: { updatedAt: true } }),
    prisma.stylist.findMany({ where: { isActive: true }, select: { slug: true, name: true, updatedAt: true } }),
    prisma.blogPost.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, publishedAt: true, updatedAt: true } }),
    prisma.serviceCategoryContent.findMany({ select: { slug: true, category: true, updatedAt: true } }),
    prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { updatedAt: true } }),
    prisma.review.aggregate({ _max: { updatedAt: true } }),
    prisma.faq.groupBy({ by: ['key'], _max: { updatedAt: true } }),
  ]);

  const categoryDates = new Map(servicesByCategory.map((row) => [row.category, row._max.updatedAt]));
  const faqDates = new Map(faqs.map((row) => [row.key, row._max.updatedAt]));
  const servicesMod = latestDate(latestService?.updatedAt, ...categoryContents.map((row) => row.updatedAt), faqDates.get('services-master'));
  const offersMod = latestOffer?.updatedAt;
  const stylistsMod = latestDate(...stylists.map((row) => row.updatedAt));
  const blogMod = latestDate(...blogPosts.map((row) => latestDate(row.updatedAt, row.publishedAt)));
  const homeMod = latestDate(servicesMod, offersMod, stylistsMod, reviews._max.updatedAt, settings?.updatedAt, faqDates.get('home'));

  return [
    { url: SITE_URL, lastModified: homeMod, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/services`, lastModified: servicesMod, changeFrequency: 'weekly', priority: 0.9 },
    ...categoryContents.map((category) => ({
      url: `${SITE_URL}/services/${category.slug}`,
      lastModified: latestDate(category.updatedAt, categoryDates.get(category.category), faqDates.get(`category:${category.slug}`), offersMod),
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),
    { url: `${SITE_URL}/offers`, lastModified: offersMod, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/contact`, lastModified: latestDate(settings?.updatedAt, faqDates.get('contact')), changeFrequency: 'monthly', priority: 0.6 },
    // Static copy has no stored revision timestamp; do not invent one per crawl.
    { url: `${SITE_URL}/try-color`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/reviews`, lastModified: reviews._max.updatedAt ?? undefined, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/blog`, lastModified: blogMod, changeFrequency: 'weekly', priority: 0.7 },
    ...blogPosts.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: latestDate(post.updatedAt, post.publishedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.65,
    })),
    { url: `${SITE_URL}/stylists`, lastModified: stylistsMod, changeFrequency: 'monthly', priority: 0.7 },
    ...stylists.map((stylist) => ({
      url: `${SITE_URL}/stylists/${stylist.slug || slugify(stylist.name)}`,
      lastModified: stylist.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ];
}
