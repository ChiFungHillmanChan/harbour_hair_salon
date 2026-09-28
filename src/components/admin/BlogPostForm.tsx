'use client';

import Link from '@/i18n/link';
import { useActionState, useEffect } from 'react';
import type { BlogActionState } from '@/app/actions/admin-blog';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { BilingualContentEditor } from './BilingualContentEditor';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

type FormAction = (prev: BlogActionState, formData: FormData) => Promise<BlogActionState>;

/** The operational part of a post; its text lives in the bilingual editor. */
type PostSettings = {
  id: string;
  slug: string;
  author: string;
  publishedAt: Date;
  readingTime: number;
  tags: string[];
  coverImage: string;
  relatedSlugs: string[];
  status: 'DRAFT' | 'PUBLISHED';
};

interface BlogPostFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  post?: PostSettings;
  saved?: boolean;
}

const salonDateTimeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: SALON_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * "YYYY-MM-DDTHH:mm" in salon time, not the browser's. Reading the local getters
 * would re-save the published date shifted by the editor's UTC offset each time
 * the form is opened abroad. (A machine value for the input, not a label, so it
 * is the same in both languages.)
 */
function toDateTimeLocal(date: Date): string {
  const parts = salonDateTimeParts.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

const fieldClass = 'w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2';

/**
 * Post SETTINGS — saved immediately. In edit mode the article text is edited
 * in the separate bilingual editor on the same screen (draft → publish); in
 * create mode that editor is embedded here, because a new post needs its text
 * in both languages first.
 */
export function BlogPostForm({ mode, action, post, saved }: BlogPostFormProps) {
  const t = useT('adminContent');
  const tc = useT('common');
  const draftKey = `blog-form:${post?.id ?? 'new'}`;
  const formRef = usePreservedForm(draftKey);
  const [state, formAction, pending] = useActionState<BlogActionState, FormData>(action, {
    status: 'idle',
  });

  useEffect(() => {
    if (state.status === 'success') clearDraft(draftKey);
  }, [state.status, draftKey]);

  // `saved` comes from ?saved=1 and never clears, so it must not outlive a
  // failed save — otherwise the green banner sits next to the red error.
  const showSavedBanner = state.status === 'success' || (!!saved && state.status !== 'error');

  return (
    <form ref={formRef} action={formAction} className="space-y-8 pb-16">
      {mode === 'edit' && post && <input type="hidden" name="id" value={post.id} />}
      {showSavedBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm" role="status">
          ✓ {t('blog.form.saved')}
        </div>
      )}

      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      {mode === 'create' && <BilingualContentEditor mode="create" type="BLOG_POST" initial={{ 'en-GB': { authorRole: 'Harbour Hair Salon, Leeds' } }} />}

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('blog.form.settingsTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t('blog.form.settingsHelp')}</p>
        </div>
        <div>
          <label htmlFor="post-slug" className={labelClass}>
            {t('blog.form.slug')}
          </label>
          <input
            id="post-slug"
            type="text"
            name="slug"
            maxLength={120}
            defaultValue={post?.slug}
            placeholder={t('blog.form.slugPlaceholder')}
            className={`${fieldClass} font-mono`}
          />
          <p className="text-xs text-zinc-500 mt-1">{t('blog.form.slugHelp', { path: '/blog/[slug]' })}</p>
        </div>
      </section>

      {/* Cover image */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('blog.form.coverTitle')}</h2>

        <div>
          <label htmlFor="post-cover" className={labelClass}>
            {t('blog.form.coverImage')} *
          </label>
          <input
            id="post-cover"
            type="text"
            name="coverImage"
            required
            defaultValue={post?.coverImage ?? '/images/services-hero.webp'}
            placeholder="/images/services-hero.webp"
            className={`${fieldClass} font-mono`}
          />
          <p className="text-xs text-zinc-500 mt-1">{t('blog.form.coverImageHelp')}</p>
        </div>
      </section>

      {/* Author + publishing */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('blog.form.publishingTitle')}</h2>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="post-author" className={labelClass}>
              {t('blog.form.author')} *
            </label>
            <input
              id="post-author"
              type="text"
              name="author"
              required
              maxLength={80}
              defaultValue={post?.author ?? 'The Harbour Team'}
              className={fieldClass}
            />
            <p className="text-xs text-zinc-500 mt-1">{t('blog.form.authorHelp')}</p>
          </div>
          <div>
            <label htmlFor="post-reading" className={labelClass}>
              {t('blog.form.readingTime')} *
            </label>
            <input
              id="post-reading"
              type="number"
              name="readingTime"
              required
              min={1}
              max={60}
              defaultValue={post?.readingTime ?? 5}
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="post-published-at" className={labelClass}>
            {t('blog.form.publishedAt')} *
          </label>
          <input
            id="post-published-at"
            type="datetime-local"
            name="publishedAt"
            required
            defaultValue={
              post ? toDateTimeLocal(post.publishedAt) : toDateTimeLocal(new Date())
            }
            className={`${fieldClass} md:max-w-sm`}
          />
        </div>

        <div>
          <label htmlFor="post-tags" className={labelClass}>
            {t('blog.form.tags')} <span className="text-zinc-400 normal-case tracking-normal">{t('blog.form.tagsHint')}</span>
          </label>
          <input
            id="post-tags"
            type="text"
            name="tags"
            maxLength={200}
            defaultValue={post?.tags.join(', ')}
            placeholder="guides, leeds, colouring"
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="post-related" className={labelClass}>
            {t('blog.form.relatedSlugs')} <span className="text-zinc-400 normal-case tracking-normal">{t('blog.form.relatedSlugsHint')}</span>
          </label>
          <input
            id="post-related"
            type="text"
            name="relatedSlugs"
            maxLength={300}
            defaultValue={post?.relatedSlugs.join(', ')}
            placeholder="best-hair-salon-leeds-what-to-look-for, perm-aftercare"
            className={`${fieldClass} font-mono`}
          />
        </div>

        <fieldset>
          <legend className={labelClass}>
            {t('blog.form.status')} *
          </legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="status"
                value="DRAFT"
                defaultChecked={post?.status !== 'PUBLISHED'}
                className="w-4 h-4"
              />
              <span>{t('blog.form.statusDraft')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="status"
                value="PUBLISHED"
                defaultChecked={post?.status === 'PUBLISHED'}
                className="w-4 h-4"
              />
              <span>{t('blog.form.statusPublished')}</span>
            </label>
          </div>
          <p className="text-xs text-zinc-500 mt-2">{t('blog.form.statusHelp')}</p>
        </fieldset>
      </section>

      {/* Submit */}
      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link
          href="/admin/blog"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          ← {t('blog.form.backToList')}
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? tc('actions.saving') : mode === 'create' ? t('blog.form.create') : t('blog.form.saveSettings')}
        </button>
      </div>
    </form>
  );
}
