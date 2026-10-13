import Image from 'next/image';
import { isLocalImagePath } from '@/app/lib/image-src';

type Props = {
  src: string;
  alt: string;
  lang?: string;
  className?: string;
  priority?: boolean;
};

/**
 * A blog cover filling its `relative` parent. Covers may be local files or a
 * Cloudinary / Google-hosted URL (the hosts admin-blog.ts accepts). Only local
 * files go through the Vercel image optimizer; remote ones render as a plain
 * <img> (CLAUDE.md), so next.config.ts needs no `remotePatterns` — those let
 * anyone have us optimise any image on those hosts, billed without a cap.
 */
export function BlogCoverImage({ src, alt, lang, className = '', priority = false }: Props) {
  if (isLocalImagePath(src)) {
    return <Image src={src} alt={alt} lang={lang} fill priority={priority} className={className} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN image, see above
    <img
      src={src}
      alt={alt}
      lang={lang}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={`absolute inset-0 h-full w-full ${className}`}
    />
  );
}
