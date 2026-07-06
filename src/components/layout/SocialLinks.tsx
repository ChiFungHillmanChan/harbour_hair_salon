import { getSocialLinks, type SocialLink } from './social-links-data';

function Icon({ k }: { k: SocialLink['key'] }) {
  const common = {
    width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (k === 'instagram') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" {...common}>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  }
  if (k === 'google') {
    // map pin
    return (
      <svg xmlns="http://www.w3.org/2000/svg" {...common}>
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    );
  }
  // treatwell — calendar/booking glyph
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...common}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export default function SocialLinks({
  settings,
  className = '',
  tone = 'light',
}: {
  settings: { instagramUrl: string; treatwellUrl: string; googleBusinessUrl: string };
  className?: string;
  // 'light' = on a light background (hover darkens to ink);
  // 'dark' = on a dark background like the footer (hover brightens to white).
  tone?: 'light' | 'dark';
}) {
  const links = getSocialLinks(settings);
  if (links.length === 0) return null;
  const hover = tone === 'dark' ? 'hover:text-white' : 'hover:text-zinc-900';
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l.label}
          className={`text-zinc-500 ${hover} transition-colors`}
        >
          <Icon k={l.key} />
        </a>
      ))}
    </div>
  );
}
