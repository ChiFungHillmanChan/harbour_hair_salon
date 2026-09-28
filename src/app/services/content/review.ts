import { LOCALES, type Locale } from '@/i18n/config';
import { CONTENT_FIELDS, fingerprint, isFilled, type ContentEntityType, type ContentFields } from './fields';

/**
 * Proofreading marks, per language. A mark records the fingerprint of the
 * language it approves AND of the other language at that moment, so:
 *
 * - editing English after Chinese was checked makes Chinese "needs review"
 *   again — existing Chinese text is never treated as checked merely because
 *   it is non-empty;
 * - editing a language after it was checked clears its own mark too.
 *
 * Pure: shared by the admin editor (status badges) and the publish step (the
 * gate). The server always recomputes; the browser's view is advisory.
 */
export type ReviewMark = { selfHash: string; otherHash: string; at: string; by?: string | null };
export type ReviewMarks = Partial<Record<Locale, ReviewMark>>;
export type BilingualFields = Record<Locale, ContentFields>;

export type LocaleStatus = {
  complete: boolean;
  missing: string[];
  reviewed: boolean;
  /** Was checked before, but it or the other language changed since. */
  needsReview: boolean;
};

export type DraftEvaluation = {
  locales: Record<Locale, LocaleStatus>;
  publishable: boolean;
};

const other = (locale: Locale): Locale => (locale === 'en-GB' ? 'zh-HK' : 'en-GB');

/** A list row with one half written and the other blank is not publishable. */
function hasHalfRow(kind: string, value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const pair = kind === 'steps' ? ['step', 'detail'] : kind === 'qaList' ? ['question', 'answer'] : null;
  if (!pair) return false;
  return value.some((row) => {
    const parts = pair.map((key) => (typeof (row as Record<string, unknown>)?.[key] === 'string' ? ((row as Record<string, string>)[key]).trim() : ''));
    return parts.some(Boolean) && !parts.every(Boolean);
  });
}

export function missingFields(type: ContentEntityType, fields: ContentFields | undefined): string[] {
  return CONTENT_FIELDS[type]
    .filter((spec) => (spec.required && !isFilled(spec.kind, fields?.[spec.key])) || hasHalfRow(spec.kind, fields?.[spec.key]))
    .map((spec) => spec.key);
}

export function reviewMark(type: ContentEntityType, fields: BilingualFields, locale: Locale, by?: string | null, at = new Date()): ReviewMark {
  return { selfHash: fingerprint(fields[locale], type), otherHash: fingerprint(fields[other(locale)], type), at: at.toISOString(), by: by ?? null };
}

export function evaluateDraft(type: ContentEntityType, fields: BilingualFields, review: ReviewMarks): DraftEvaluation {
  const locales = {} as Record<Locale, LocaleStatus>;
  for (const locale of LOCALES) {
    const missing = missingFields(type, fields[locale]);
    const mark = review[locale];
    const reviewed = Boolean(mark)
      && mark!.selfHash === fingerprint(fields[locale], type)
      && mark!.otherHash === fingerprint(fields[other(locale)], type);
    locales[locale] = { complete: missing.length === 0, missing, reviewed, needsReview: Boolean(mark) && !reviewed };
  }
  const publishable = LOCALES.every((locale) => locales[locale].complete && locales[locale].reviewed);
  return { locales, publishable };
}

/** Normalise untrusted editor input to the field kinds declared for the type. */
export function sanitizeFields(type: ContentEntityType, input: unknown): ContentFields {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const fields: ContentFields = {};
  for (const spec of CONTENT_FIELDS[type]) {
    const value = source[spec.key];
    switch (spec.kind) {
      case 'text':
      case 'longtext':
        fields[spec.key] = typeof value === 'string' ? value.slice(0, spec.kind === 'text' ? 300 : 20_000) : '';
        break;
      case 'stringList':
        fields[spec.key] = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 2_000)).filter((item) => item.trim()).slice(0, 50) : [];
        break;
      case 'steps':
        // Wholly blank rows are dropped; half-filled rows are kept so the
        // editor can show them, and block publishing (missingFields).
        fields[spec.key] = Array.isArray(value)
          ? value.flatMap((item) => (item && typeof item === 'object' && typeof (item as { step?: unknown }).step === 'string' && typeof (item as { detail?: unknown }).detail === 'string'
            ? [{ step: (item as { step: string }).step.slice(0, 300), detail: (item as { detail: string }).detail.slice(0, 2_000) }] : []))
            .filter((row) => row.step.trim() || row.detail.trim()).slice(0, 30)
          : [];
        break;
      case 'qaList':
        fields[spec.key] = Array.isArray(value)
          ? value.flatMap((item) => (item && typeof item === 'object' && typeof (item as { question?: unknown }).question === 'string' && typeof (item as { answer?: unknown }).answer === 'string'
            ? [{ question: (item as { question: string }).question.slice(0, 500), answer: (item as { answer: string }).answer.slice(0, 5_000) }] : []))
            .filter((row) => row.question.trim() || row.answer.trim()).slice(0, 40)
          : [];
        break;
      case 'blogSections':
        fields[spec.key] = Array.isArray(value)
          ? value.filter(isBlogSection).filter((section) => {
            const s = section as { type: string; text?: string; items?: string[] };
            return s.type === 'list' ? (s.items ?? []).some((item) => item.trim()) : Boolean(s.text?.trim());
          }).map((section) => {
            const s = section as { type: string; items?: string[] };
            return s.type === 'list' ? { ...section as object, items: (s.items ?? []).filter((item) => item.trim()) } : section;
          }).slice(0, 200)
          : [];
        break;
    }
  }
  return fields;
}

function isBlogSection(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const section = value as Record<string, unknown>;
  if (section.type === 'paragraph') return typeof section.text === 'string';
  if (section.type === 'heading') return (section.level === 2 || section.level === 3) && typeof section.text === 'string';
  if (section.type === 'list') return Array.isArray(section.items) && section.items.every((item) => typeof item === 'string');
  if (section.type === 'quote') return typeof section.text === 'string' && (section.attribution === undefined || typeof section.attribution === 'string');
  return false;
}
