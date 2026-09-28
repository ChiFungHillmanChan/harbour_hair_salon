/**
 * Which fields of which records are TRANSLATABLE content. Everything else —
 * ids, slugs, prices, durations, images, flags, brands, permissions, booking
 * rules — is shared by both languages and exists once, so the two languages
 * cannot drift apart on anything but wording.
 *
 * Pure module: used by the public read path, the admin editor, the publish
 * step, the import tool and tests.
 */
export const CONTENT_ENTITY_TYPES = [
  'SERVICE',
  'SERVICE_OFFERING',
  'CATEGORY_CONTENT',
  'FAQ',
  'BLOG_POST',
  'STYLIST',
  'OFFER',
  'SITE_SETTINGS',
] as const;
export type ContentEntityType = (typeof CONTENT_ENTITY_TYPES)[number];

export type FieldKind =
  | 'text' // one line
  | 'longtext' // paragraph(s)
  | 'stringList' // string[]
  | 'steps' // { step, detail }[]
  | 'qaList' // { question, answer }[]
  | 'blogSections'; // BlogSection[] (see blog-service)

export type FieldSpec = {
  key: string;
  kind: FieldKind;
  /** Must be non-empty in BOTH languages before a revision can be published. */
  required: boolean;
  /** Entity column holding the published English value (JSON-encoded for lists). */
  column: string;
  /** The column accepts NULL; an empty optional value is stored as NULL. */
  nullable: boolean;
};

const f = (key: string, kind: FieldKind, required: boolean, column = key, nullable = false): FieldSpec => ({ key, kind, required, column, nullable });
const optional = (key: string, kind: FieldKind): FieldSpec => f(key, kind, false, key, true);

export const CONTENT_FIELDS: Record<ContentEntityType, FieldSpec[]> = {
  SERVICE: [f('name', 'text', true), optional('description', 'longtext'), optional('priceNote', 'longtext')],
  SERVICE_OFFERING: [f('name', 'text', true), optional('description', 'longtext')],
  CATEGORY_CONTENT: [
    f('title', 'text', true), f('hero', 'text', true), f('metaDescription', 'longtext', true), f('intro', 'longtext', true),
    f('overview', 'stringList', false, 'overviewJson'), f('includes', 'stringList', false, 'includesJson'),
    f('process', 'steps', false, 'processJson'), f('aftercare', 'stringList', false, 'aftercareJson'),
    f('faqs', 'qaList', false, 'faqsJson'),
  ],
  FAQ: [f('question', 'text', true), f('answer', 'longtext', true)],
  BLOG_POST: [
    f('title', 'text', true), f('description', 'longtext', true), f('excerpt', 'longtext', true), f('authorRole', 'text', false),
    f('coverAlt', 'text', true), f('lede', 'longtext', true), f('sections', 'blogSections', true, 'sectionsJson'),
  ],
  STYLIST: [
    f('role', 'text', true), optional('bio', 'longtext'), optional('tagline', 'text'),
    f('specialties', 'stringList', false, 'specialtiesJson'), f('languages', 'stringList', false, 'languagesJson'),
    optional('trainedIn', 'text'), f('extendedBio', 'stringList', false, 'extendedBioJson'),
  ],
  OFFER: [f('title', 'text', true), optional('description', 'longtext')],
  SITE_SETTINGS: [
    f('heroEyebrow', 'text', true), f('heroTitleLine1', 'text', true), f('heroTitleLine2', 'text', true), f('heroSubtitle', 'longtext', true),
  ],
};

export type ContentFields = Record<string, unknown>;

/** Read the English published fields straight from an entity row. */
export function englishFieldsFromRow(type: ContentEntityType, row: Record<string, unknown>): ContentFields {
  const fields: ContentFields = {};
  for (const spec of CONTENT_FIELDS[type]) {
    const raw = row[spec.column];
    if (spec.column.endsWith('Json')) {
      try { fields[spec.key] = typeof raw === 'string' && raw ? JSON.parse(raw) : []; } catch { fields[spec.key] = []; }
    } else {
      fields[spec.key] = raw ?? '';
    }
  }
  return fields;
}

/** Entity columns to write when English fields are published. */
export function rowFromEnglishFields(type: ContentEntityType, fields: ContentFields): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const spec of CONTENT_FIELDS[type]) {
    if (!(spec.key in fields)) continue;
    const value = fields[spec.key];
    if (spec.column.endsWith('Json')) row[spec.column] = JSON.stringify(value ?? []);
    else if (typeof value === 'string') row[spec.column] = value.trim() === '' && spec.nullable ? null : value;
    else row[spec.column] = spec.nullable ? null : '';
  }
  return row;
}

/** True when a value counts as filled in for its kind. */
export function isFilled(kind: FieldKind, value: unknown): boolean {
  if (kind === 'text' || kind === 'longtext') return typeof value === 'string' && value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

/** Stable text fingerprint of one language's fields (review tracking). */
export function fingerprint(fields: ContentFields | undefined, type: ContentEntityType): string {
  const ordered = CONTENT_FIELDS[type].map((spec) => [spec.key, fields?.[spec.key] ?? null]);
  const text = JSON.stringify(ordered);
  // FNV-1a — collision resistance is irrelevant here, only change detection.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + text.length.toString(16);
}
