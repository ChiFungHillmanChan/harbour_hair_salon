import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/app/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private and transactional pages in both languages. These pages are
      // also noindex and protected server-side; robots is not the lock.
      disallow: [
        '/admin', '/auth/', '/appointments', '/api/', '/book', '/kiosk',
        '/zh-hk/admin', '/zh-hk/auth/', '/zh-hk/appointments', '/zh-hk/book', '/zh-hk/kiosk',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
