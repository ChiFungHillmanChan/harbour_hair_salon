'use server';

import { revalidatePath, updateTag } from 'next/cache';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { isLocale, type Locale } from '@/i18n/config';
import { getActionT } from '@/i18n/request';
import { CONTENT_ENTITY_TYPES, type ContentEntityType } from '@/app/services/content/fields';
import {
  ContentError,
  discardDraft,
  getEditorState,
  markReviewed,
  publishDraft,
  saveDraft,
  type EditorState,
  type SharedFields,
} from '@/app/services/content/drafts';
import { applyServicePrice, ServicePriceError } from '@/app/services/pricing/service-price';

export type ContentActionResult = { ok: true; state: EditorState; message?: string } | { ok: false; error: string };

async function requireAdmin(): Promise<string | null> {
  const session = await verifySession();
  return session.role === 'ADMIN' ? session.userId : null;
}

function isEntityType(value: unknown): value is ContentEntityType {
  return typeof value === 'string' && (CONTENT_ENTITY_TYPES as readonly string[]).includes(value);
}

async function fail(code: string): Promise<ContentActionResult> {
  const t = await getActionT('adminContent');
  return { ok: false, error: t.dynamic(`editor.errors.${code}`, undefined, t('editor.errors.GENERIC')) };
}

async function guard(type: unknown, id: unknown): Promise<{ adminId: string; type: ContentEntityType; id: string } | ContentActionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return fail('NOT_AUTHORISED');
  if (!isEntityType(type) || typeof id !== 'string' || !id || id.length > 64) return fail('INVALID');
  return { adminId, type, id };
}

function sharedFor(type: ContentEntityType, shared: unknown): SharedFields | undefined {
  if (type !== 'SERVICE' || !shared || typeof shared !== 'object') return undefined;
  const price = (shared as { price?: unknown }).price;
  return typeof price === 'string' && /^\d{1,6}(\.\d{1,2})?$/.test(price.trim()) ? { price: price.trim() } : {};
}

/**
 * Publishing changes what both languages show. Content publishes are rare,
 * deliberate admin events, so refresh every page (both `[locale]` trees) and
 * the cached data behind them rather than risk one language staying stale.
 */
function refreshPublicPages() {
  updateTag('site-settings');
  updateTag('active-offers');
  revalidatePath('/', 'layout');
  revalidatePath('/sitemap.xml');
}

export async function saveContentDraftAction(type: ContentEntityType, id: string, fields: unknown, shared?: unknown): Promise<ContentActionResult> {
  const checked = await guard(type, id);
  if (!('adminId' in checked)) return checked;
  try {
    const state = await prisma.$transaction((tx) => saveDraft(tx, checked.type, checked.id, { fields, shared: sharedFor(checked.type, shared), adminId: checked.adminId }));
    return { ok: true, state };
  } catch (error) {
    if (error instanceof ContentError) return fail(error.code);
    console.error('saveContentDraftAction failed', error);
    return fail('GENERIC');
  }
}

export async function markContentReviewedAction(type: ContentEntityType, id: string, locale: Locale): Promise<ContentActionResult> {
  const checked = await guard(type, id);
  if (!('adminId' in checked)) return checked;
  if (!isLocale(locale)) return fail('INVALID');
  try {
    const state = await prisma.$transaction((tx) => markReviewed(tx, checked.type, checked.id, locale, checked.adminId));
    return { ok: true, state };
  } catch (error) {
    if (error instanceof ContentError) return fail(error.code);
    console.error('markContentReviewedAction failed', error);
    return fail('GENERIC');
  }
}

export async function publishContentAction(type: ContentEntityType, id: string): Promise<ContentActionResult> {
  const checked = await guard(type, id);
  if (!('adminId' in checked)) return checked;
  try {
    const state = await prisma.$transaction(async (tx) => {
      await publishDraft(tx, checked.type, checked.id, checked.adminId, {
        // A service's price goes live together with its text, never ahead of it.
        applyShared: checked.type === 'SERVICE' ? (db, shared) => applyServicePrice(db, checked.id, shared.price) : undefined,
      });
      return getEditorState(tx, checked.type, checked.id);
    }, { isolationLevel: 'Serializable' });
    refreshPublicPages();
    const t = await getActionT('adminContent');
    return { ok: true, state, message: t('editor.published', { revision: state.revision }) };
  } catch (error) {
    if (error instanceof ContentError) return fail(error.code);
    if (error instanceof ServicePriceError) return fail(error.code);
    console.error('publishContentAction failed', error);
    return fail('GENERIC');
  }
}

export async function discardContentDraftAction(type: ContentEntityType, id: string): Promise<ContentActionResult> {
  const checked = await guard(type, id);
  if (!('adminId' in checked)) return checked;
  try {
    const state = await prisma.$transaction(async (tx) => {
      await discardDraft(tx, checked.type, checked.id);
      return getEditorState(tx, checked.type, checked.id);
    });
    return { ok: true, state };
  } catch (error) {
    if (error instanceof ContentError) return fail(error.code);
    console.error('discardContentDraftAction failed', error);
    return fail('GENERIC');
  }
}
