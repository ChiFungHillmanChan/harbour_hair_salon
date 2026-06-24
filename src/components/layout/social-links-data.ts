export type SocialLink = {
  key: 'instagram' | 'treatwell' | 'google';
  label: string;
  href: string;
};

type SocialSettings = {
  instagramUrl: string;
  treatwellUrl: string;
  googleBusinessUrl: string;
};

export function getSocialLinks(settings: SocialSettings): SocialLink[] {
  const candidates: SocialLink[] = [
    { key: 'instagram', label: 'Instagram', href: settings.instagramUrl },
    { key: 'treatwell', label: 'Book on Treatwell', href: settings.treatwellUrl },
    { key: 'google', label: 'Find us on Google', href: settings.googleBusinessUrl },
  ];
  return candidates.filter((l) => l.href && l.href.trim().length > 0);
}
