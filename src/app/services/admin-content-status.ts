import 'server-only';
import prisma from '@/app/lib/prisma';
import type { ContentEntityType } from './content/fields';

/** Translation state of one record, for admin lists. */
export type ContentStatus = { chinesePublished: boolean; draftPending: boolean };

/**
 * Whether each record has a published Chinese version and an unpublished
 * bilingual draft — two queries for a whole list, so an admin list can flag
 * what still needs translating without loading every record's editor state.
 */
export async function loadContentStatus(type: ContentEntityType, ids: readonly string[]): Promise<Map<string, ContentStatus>> {
  const unique = [...new Set(ids)];
  const status = new Map<string, ContentStatus>(unique.map((id) => [id, { chinesePublished: false, draftPending: false }]));
  if (unique.length === 0) return status;
  const [translations, drafts] = await Promise.all([
    prisma.contentTranslation.findMany({ where: { entityType: type, locale: 'zh-HK', entityId: { in: unique } }, select: { entityId: true } }),
    prisma.contentDraft.findMany({ where: { entityType: type, entityId: { in: unique } }, select: { entityId: true } }),
  ]);
  for (const row of translations) status.get(row.entityId)!.chinesePublished = true;
  for (const row of drafts) status.get(row.entityId)!.draftPending = true;
  return status;
}
