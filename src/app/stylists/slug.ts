import 'server-only';
import prisma from '@/app/lib/prisma';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type StylistRuntime = {
  id: string;
  name: string;
  bio: string | null;
  imageUrl: string | null;
  role: string;
  slug: string;
  tagline: string | null;
  specialties: string[];
  languages: string[];
  yearsExperience: number | null;
  trainedIn: string | null;
  extendedBio: string[];
  updatedAt: Date;
};

function safeParseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

type DbStylist = {
  id: string;
  name: string;
  bio: string | null;
  imageUrl: string | null;
  role: string;
  slug: string | null;
  tagline: string | null;
  specialtiesJson: string;
  languagesJson: string;
  yearsExperience: number | null;
  trainedIn: string | null;
  extendedBioJson: string;
  updatedAt: Date;
};

// Explicit projection — never fetch the whole model here. The full row carries
// secrets (treatwellIcalUrl, icalToken) that must stay out of public payloads,
// and these queries run at build time for /stylists pages and the sitemap, so
// selecting a column the database doesn't have yet would fail preview builds
// (previews deploy without running migrations).
const publicStylistSelect = {
  id: true,
  name: true,
  bio: true,
  imageUrl: true,
  role: true,
  slug: true,
  tagline: true,
  specialtiesJson: true,
  languagesJson: true,
  yearsExperience: true,
  trainedIn: true,
  extendedBioJson: true,
  updatedAt: true,
} as const;

function mapStylist(row: DbStylist): StylistRuntime {
  return {
    id: row.id,
    name: row.name,
    bio: row.bio,
    imageUrl: row.imageUrl,
    role: row.role,
    slug: row.slug ?? slugify(row.name),
    tagline: row.tagline,
    specialties: safeParseStringArray(row.specialtiesJson),
    languages: safeParseStringArray(row.languagesJson),
    yearsExperience: row.yearsExperience,
    trainedIn: row.trainedIn,
    extendedBio: safeParseStringArray(row.extendedBioJson),
    updatedAt: row.updatedAt,
  };
}

export async function getAllStylistsWithSlug(): Promise<StylistRuntime[]> {
  const stylists = await prisma.stylist.findMany({
    orderBy: { name: 'asc' },
    select: publicStylistSelect,
  });
  return stylists.map(mapStylist);
}

export async function getStylistBySlug(slug: string): Promise<StylistRuntime | null> {
  const all = await getAllStylistsWithSlug();
  return all.find((s) => s.slug === slug) ?? null;
}

export async function getStylistById(id: string): Promise<StylistRuntime | null> {
  const row = await prisma.stylist.findUnique({
    where: { id },
    select: publicStylistSelect,
  });
  return row ? mapStylist(row) : null;
}
