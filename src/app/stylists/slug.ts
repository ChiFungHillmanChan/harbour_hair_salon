import 'server-only';
import prisma from '@/app/lib/prisma';
import { cache } from 'react';
import type { Prisma } from '@prisma/client';

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

// Explicit projection — never fetch the whole model here. The full row carries
// secrets (treatwellIcalUrl, icalToken) that must stay out of public payloads,
// and these queries run at build time for /stylists pages, so
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
} satisfies Prisma.StylistSelect;

function mapStylist(row: Prisma.StylistGetPayload<{ select: typeof publicStylistSelect }>): StylistRuntime {
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

export const getAllStylistsWithSlug = cache(async (): Promise<StylistRuntime[]> => {
  const stylists = await prisma.stylist.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: publicStylistSelect,
  });
  return stylists.map(mapStylist);
});

export const getStylistBySlug = cache(async (slug: string): Promise<StylistRuntime | null> => {
  const row = await prisma.stylist.findUnique({
    where: { slug, isActive: true }, select: publicStylistSelect,
  });
  if (row) return mapStylist(row);
  // Legacy profiles predate stored slugs. Only those rows need name matching.
  const legacy = await prisma.stylist.findMany({
    where: { isActive: true, slug: null }, orderBy: { name: 'asc' }, select: publicStylistSelect,
  });
  const match = legacy.find((stylist) => slugify(stylist.name) === slug);
  return match ? mapStylist(match) : null;
});

export async function getStylistSlugs() {
  const rows = await prisma.stylist.findMany({
    where: { isActive: true }, select: { slug: true, name: true },
  });
  return rows.map((row) => ({ slug: row.slug ?? slugify(row.name) }));
}

export async function getRelatedStylists(excludeId: string) {
  const rows = await prisma.stylist.findMany({
    where: { isActive: true, id: { not: excludeId } }, orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 3, select: { id: true, name: true, slug: true, role: true, imageUrl: true },
  });
  return rows.map((row) => ({ ...row, slug: row.slug ?? slugify(row.name) }));
}

export async function getStylistById(id: string): Promise<StylistRuntime | null> {
  const row = await prisma.stylist.findUnique({
    where: { id },
    select: publicStylistSelect,
  });
  return row ? mapStylist(row) : null;
}
