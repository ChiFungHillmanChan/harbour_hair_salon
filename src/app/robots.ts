import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/auth/', '/appointments', '/api/', '/book'],
    },
    sitemap: 'https://harbourhairsalon.co.uk/sitemap.xml',
  };
}
