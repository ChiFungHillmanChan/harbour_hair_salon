import type { MetadataRoute } from 'next';
import prisma from '@/app/lib/prisma';
import { getAllCategoryContent } from '@/app/services/category-content-service';
import { getPublishedPosts } from '@/app/services/blog-service';
import { getAllStylistsWithSlug } from '@/app/stylists/slug';
import { SITE_URL } from '@/app/lib/site-url';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = SITE_URL;

  const [
    latestService,
    latestOffer,
    servicesByCategory,
    stylists,
    blogPosts,
    categoryContents,
  ] = await Promise.all([
    prisma.service.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }).catch(() => null),
    prisma.offer.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }).catch(() => null),
    prisma.service.groupBy({
      by: ['category'],
      _max: { updatedAt: true },
    }).catch(() => [] as { category: string; _max: { updatedAt: Date | null } }[]),
    getAllStylistsWithSlug().catch(() => []),
    getPublishedPosts().catch(() => []),
    getAllCategoryContent().catch(() => []),
  ]);

  const now = new Date();
  const servicesMod = latestService?.updatedAt ?? now;
  const offersMod = latestOffer?.updatedAt ?? now;
  const homeMod = new Date(
    Math.max(servicesMod.getTime(), offersMod.getTime())
  );

  const categoryModByName = new Map<string, Date>();
  for (const row of servicesByCategory) {
    if (row._max.updatedAt) categoryModByName.set(row.category, row._max.updatedAt);
  }

  const categoryEntries: MetadataRoute.Sitemap = categoryContents.map((c) => ({
    url: `${baseUrl}/services/${c.slug}`,
    lastModified: categoryModByName.get(c.category) ?? c.updatedAt ?? servicesMod,
    changeFrequency: 'weekly' as const,
    priority: 0.85,
  }));

  return [
    {
      url: baseUrl,
      lastModified: homeMod,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/services`,
      lastModified: servicesMod,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...categoryEntries,
    {
      url: `${baseUrl}/offers`,
      lastModified: offersMod,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/try-color`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/reviews`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: blogPosts[0]?.publishedAt ?? now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    ...blogPosts.map((post) => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: post.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.65,
    })),
    {
      url: `${baseUrl}/stylists`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    },
    ...stylists.map((s) => ({
      url: `${baseUrl}/stylists/${s.slug}`,
      lastModified: s.updatedAt ?? now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ];
}
