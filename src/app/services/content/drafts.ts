import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { LOCALES, type Locale } from '@/i18n/config';
import { CONTENT_FIELDS, englishFieldsFromRow, rowFromEnglishFields, type ContentEntityType, type ContentFields } from './fields';
import { evaluateDraft, reviewMark, sanitizeFields, type BilingualFields, type DraftEvaluation, type ReviewMarks } from './review';

/**
 * Draft → publish for the site's own translatable content.
 *
 *   save draft   writes ContentDraft only; the public site keeps showing the
 *                last published revision in BOTH languages.
 *   mark checked records a proofreading mark for one language (review.ts).
 *   publish      one transaction: English into the entity's own columns,
 *                both languages into ContentTranslation with the same new
 *                revision number, draft removed. Refused unless both
 *                languages are complete and checked against each other, and
 *                unless nobody else published since the draft was started.
 *
 * Drafts never reach public queries: those read entity columns and
 * ContentTranslation only (translations.ts).
 */
export class ContentError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_READY' | 'CONFLICT' | 'NO_DRAFT') {
    super(code);
    this.name = 'ContentError';
  }
}

type Db = Prisma.TransactionClient;
type Delegate = {
  findUnique(args: { where: { id: string }; select?: Record<string, boolean> }): Promise<Record<string, unknown> | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
};

const MODEL: Record<ContentEntityType, keyof PrismaClient> = {
  SERVICE: 'service',
  SERVICE_OFFERING: 'serviceOffering',
  CATEGORY_CONTENT: 'serviceCategoryContent',
  FAQ: 'faq',
  BLOG_POST: 'blogPost',
  STYLIST: 'stylist',
  OFFER: 'offer',
  SITE_SETTINGS: 'siteSettings',
};

function delegate(db: Db, type: ContentEntityType): Delegate {
  return (db as unknown as Record<string, Delegate>)[MODEL[type] as string];
}

function contentSelect(type: ContentEntityType): Record<string, boolean> {
  const select: Record<string, boolean> = { id: true };
  for (const spec of CONTENT_FIELDS[type]) select[spec.column] = true;
  return select;
}

export type SharedFields = { price?: string };

export type EditorState = {
  entityType: ContentEntityType;
  entityId: string;
  revision: number;
  published: BilingualFields;
  /** What the editor shows: the draft when one exists, otherwise the published text. */
  working: BilingualFields;
  review: ReviewMarks;
  shared: SharedFields;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  evaluation: DraftEvaluation;
};

function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

async function publishedState(db: Db, type: ContentEntityType, id: string) {
  const row = await delegate(db, type).findUnique({ where: { id }, select: contentSelect(type) });
  if (!row) throw new ContentError('NOT_FOUND');
  const translations = await db.contentTranslation.findMany({ where: { entityType: type, entityId: id }, select: { locale: true, fieldsJson: true, revision: true } });
  const published = { 'en-GB': englishFieldsFromRow(type, row), 'zh-HK': {} } as BilingualFields;
  let revision = 0;
  for (const translation of translations) {
    revision = Math.max(revision, translation.revision);
    if (translation.locale === 'zh-HK') published['zh-HK'] = sanitizeFields(type, parseJson(translation.fieldsJson, {}));
  }
  return { published, revision };
}

export async function getEditorState(db: Db, type: ContentEntityType, id: string): Promise<EditorState> {
  const [{ published, revision }, draft] = await Promise.all([
    publishedState(db, type, id),
    db.contentDraft.findUnique({ where: { entityType_entityId: { entityType: type, entityId: id } } }),
  ]);
  const working = draft ? normalizeBilingual(type, parseJson(draft.fieldsJson, {})) : published;
  // Without a draft the published text is by definition the checked text.
  const review: ReviewMarks = draft
    ? parseJson<ReviewMarks>(draft.reviewJson, {})
    : Object.fromEntries(revision > 0 ? LOCALES.map((locale) => [locale, reviewMark(type, published, locale)]) : []);
  return {
    entityType: type,
    entityId: id,
    revision,
    published,
    working,
    review,
    shared: draft ? parseJson<SharedFields>(draft.sharedJson, {}) : {},
    hasDraft: Boolean(draft),
    draftUpdatedAt: draft ? draft.updatedAt.toISOString() : null,
    evaluation: evaluateDraft(type, working, review),
  };
}

function normalizeBilingual(type: ContentEntityType, input: unknown): BilingualFields {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return { 'en-GB': sanitizeFields(type, source['en-GB']), 'zh-HK': sanitizeFields(type, source['zh-HK']) };
}

/**
 * Save both languages as one draft. Marks survive only for a language whose
 * text (and whose counterpart) did not change — see review.ts.
 */
export async function saveDraft(
  db: Db,
  type: ContentEntityType,
  id: string,
  input: { fields: unknown; shared?: SharedFields; adminId: string | null },
): Promise<EditorState> {
  const { revision } = await publishedState(db, type, id);
  const fields = normalizeBilingual(type, input.fields);
  const existing = await db.contentDraft.findUnique({ where: { entityType_entityId: { entityType: type, entityId: id } } });
  const review = existing ? parseJson<ReviewMarks>(existing.reviewJson, {}) : {};
  const data = {
    fieldsJson: JSON.stringify(fields),
    reviewJson: JSON.stringify(review),
    sharedJson: JSON.stringify(input.shared ?? (existing ? parseJson<SharedFields>(existing.sharedJson, {}) : {})),
    updatedByAdminId: input.adminId,
  };
  await db.contentDraft.upsert({
    where: { entityType_entityId: { entityType: type, entityId: id } },
    create: { entityType: type, entityId: id, baseRevision: revision, ...data },
    update: data,
  });
  return getEditorState(db, type, id);
}

/** Record that `locale` was proofread against the other language as they stand now. */
export async function markReviewed(db: Db, type: ContentEntityType, id: string, locale: Locale, adminId: string | null): Promise<EditorState> {
  const draft = await db.contentDraft.findUnique({ where: { entityType_entityId: { entityType: type, entityId: id } } });
  if (!draft) throw new ContentError('NO_DRAFT');
  const fields = normalizeBilingual(type, parseJson(draft.fieldsJson, {}));
  const review = parseJson<ReviewMarks>(draft.reviewJson, {});
  review[locale] = reviewMark(type, fields, locale, adminId);
  await db.contentDraft.update({ where: { id: draft.id }, data: { reviewJson: JSON.stringify(review), updatedByAdminId: adminId } });
  return getEditorState(db, type, id);
}

export async function discardDraft(db: Db, type: ContentEntityType, id: string) {
  await db.contentDraft.deleteMany({ where: { entityType: type, entityId: id } });
}

export type PublishHooks = {
  /** Apply non-text fields that must go live with the text (e.g. a service price). */
  applyShared?: (db: Db, shared: SharedFields) => Promise<void>;
};

/**
 * Publish the draft. Must run inside a transaction (the caller's), so the
 * entity, both translations and the draft removal commit together or not at
 * all.
 */
export async function publishDraft(db: Db, type: ContentEntityType, id: string, adminId: string | null, hooks: PublishHooks = {}): Promise<{ revision: number }> {
  const draft = await db.contentDraft.findUnique({ where: { entityType_entityId: { entityType: type, entityId: id } } });
  if (!draft) throw new ContentError('NO_DRAFT');
  const { revision } = await publishedState(db, type, id);
  if (draft.baseRevision !== revision) throw new ContentError('CONFLICT');
  const fields = normalizeBilingual(type, parseJson(draft.fieldsJson, {}));
  const review = parseJson<ReviewMarks>(draft.reviewJson, {});
  if (!evaluateDraft(type, fields, review).publishable) throw new ContentError('NOT_READY');
  const next = revision + 1;
  await writePublished(db, type, id, fields, next, adminId);
  if (hooks.applyShared) await hooks.applyShared(db, parseJson<SharedFields>(draft.sharedJson, {}));
  await db.contentDraft.delete({ where: { id: draft.id } });
  await db.auditEvent.create({ data: { actorUserId: adminId, action: 'CONTENT.PUBLISH', targetType: type, targetId: id, metadataJson: JSON.stringify({ revision: next }) } });
  return { revision: next };
}

/** Write one revision of both languages (publish, first bilingual create, import tool). */
export async function writePublished(db: Db, type: ContentEntityType, id: string, fields: BilingualFields, revision: number, adminId: string | null) {
  await delegate(db, type).update({ where: { id }, data: rowFromEnglishFields(type, fields['en-GB']) });
  for (const locale of LOCALES) {
    const fieldsJson = JSON.stringify(fields[locale]);
    await db.contentTranslation.upsert({
      where: { entityType_entityId_locale: { entityType: type, entityId: id, locale } },
      create: { entityType: type, entityId: id, locale, fieldsJson, revision, publishedByAdminId: adminId },
      update: { fieldsJson, revision, publishedAt: new Date(), publishedByAdminId: adminId },
    });
  }
}

/**
 * For create screens: a new record goes live only with both languages
 * complete and confirmed proofread, in one step — there is no English-only
 * interval. `create` makes the entity row (English columns included).
 */
export async function createPublished(
  db: Db,
  type: ContentEntityType,
  input: { fields: unknown; confirmedReviewed: boolean; adminId: string | null },
  create: (english: ContentFields) => Promise<{ id: string }>,
): Promise<{ id: string }> {
  const fields = normalizeBilingual(type, input.fields);
  const review: ReviewMarks = input.confirmedReviewed
    ? Object.fromEntries(LOCALES.map((locale) => [locale, reviewMark(type, fields, locale, input.adminId)]))
    : {};
  if (!evaluateDraft(type, fields, review).publishable) throw new ContentError('NOT_READY');
  const created = await create(fields['en-GB']);
  await writePublished(db, type, created.id, fields, 1, input.adminId);
  return created;
}

/** Remove every translation and draft of a deleted record. */
export async function deleteContent(db: Db, type: ContentEntityType, id: string) {
  await db.contentTranslation.deleteMany({ where: { entityType: type, entityId: id } });
  await db.contentDraft.deleteMany({ where: { entityType: type, entityId: id } });
}

export type { BilingualFields, ContentFields };
