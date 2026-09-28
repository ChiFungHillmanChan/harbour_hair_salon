import type { Prisma } from '@prisma/client';
import type { Locale } from '@/i18n/config';
import type { ContentEntityType, ContentFields } from './fields';

type Reader = Pick<Prisma.TransactionClient, 'contentTranslation'>;

/**
 * PUBLISHED translations for a set of records in one language. English is the
 * entity row itself, so an English request costs no query. Drafts live in a
 * different table (ContentDraft) and are never read here — public pages and
 * their RSC payloads cannot leak an unpublished revision.
 */
export async function loadPublishedTranslations(
  db: Reader,
  entityType: ContentEntityType,
  ids: readonly string[],
  locale: Locale,
): Promise<Map<string, ContentFields>> {
  const map = new Map<string, ContentFields>();
  if (locale === 'en-GB' || ids.length === 0) return map;
  const rows = await db.contentTranslation.findMany({
    where: { entityType, locale, entityId: { in: [...new Set(ids)] } },
    select: { entityId: true, fieldsJson: true },
  });
  for (const row of rows) {
    try {
      const fields = JSON.parse(row.fieldsJson) as ContentFields;
      if (fields && typeof fields === 'object') map.set(row.entityId, fields);
    } catch {
      // A corrupt row falls back to English rather than breaking the page.
    }
  }
  return map;
}

/**
 * Overlay translated text onto a record. Only listed text keys are replaced,
 * and only with non-empty strings; everything shared (ids, prices, flags)
 * always comes from the record. `translated` tells the page whether the
 * visitor's language was actually available (English fallback is marked with
 * lang="en" in the markup, and reported as missing in the admin coverage list).
 */
export function overlay<T extends Record<string, unknown>>(row: T, fields: ContentFields | undefined, keys: readonly (keyof T & string)[]): T & { translated: boolean } {
  if (!fields) return { ...row, translated: false };
  const next: Record<string, unknown> = { ...row };
  let any = false;
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) {
      next[key] = value;
      any = true;
    } else if (Array.isArray(value) && value.length > 0) {
      next[key] = value;
      any = true;
    }
  }
  return { ...(next as T), translated: any };
}
