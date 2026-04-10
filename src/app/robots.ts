import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/app/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/auth/', '/appointments', '/api/', '/book'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
