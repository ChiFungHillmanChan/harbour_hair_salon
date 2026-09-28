'use client';

import Link from '@/i18n/link';
import { useActionState, useEffect } from 'react';
import type { CategoryActionState } from '@/app/actions/admin-categories';
import { BilingualContentEditor } from './BilingualContentEditor';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

type FormAction = (prev: CategoryActionState, formData: FormData) => Promise<CategoryActionState>;

/** The operational part of a category page; its text lives in the bilingual editor. */
type CategorySettings = {
  id: string;
  slug: string;
  category: string;
  relatedSlugs: string[];
  displayOrder: number;
};

interface CategoryContentFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  content?: CategorySettings;
  saved?: boolean;
  existingCategories: string[];
}

const fieldClass = 'w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2';

/**
 * Category page SETTINGS (slug, category, related pages, order) — saved
 * immediately. In edit mode the page text is edited in the separate bilingual
 * editor on the same screen (draft → publish); in create mode that editor is
 * embedded here, because a new page needs its text in both languages first.
 */
export function CategoryContentForm({
  mode,
  action,
  content,
  saved,
  existingCategories,
}: CategoryContentFormProps) {
  const t = useT('adminCatalog');
  const tc = useT('common');
  const draftKey = `category-form:${content?.id ?? 'new'}`;
  const formRef = usePreservedForm(draftKey);
  const [state, formAction, pending] = useActionState<CategoryActionState, FormData>(action, {
    status: 'idle',
  });

  useEffect(() => {
    if (state.status === 'success') clearDraft(draftKey);
  }, [state.status, draftKey]);

  // `saved` comes from ?saved=1 and never clears, so it must not outlive a
  // failed save — otherwise the green banner sits next to the red error.
  const showSavedBanner = state.status === 'success' || (!!saved && state.status !== 'error');

  return (
    <form ref={formRef} action={formAction} className="space-y-6 pb-16">
      {mode === 'edit' && content && <input type="hidden" name="id" value={content.id} />}

      {showSavedBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm" role="status">
          ✓ {t('categories.form.saved')}
        </div>
      )}
      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      {mode === 'create' && <BilingualContentEditor mode="create" type="CATEGORY_CONTENT" />}

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('categories.form.settingsTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t('categories.form.settingsHelp')}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="category-slug" className={labelClass}>
              {t('categories.form.slug')} * <span className="text-zinc-400 normal-case tracking-normal">{t('categories.form.slugHint')}</span>
            </label>
            <input
              id="category-slug"
              type="text"
              name="slug"
              required
              minLength={2}
              maxLength={100}
              defaultValue={content?.slug}
              placeholder={t('categories.form.slugPlaceholder')}
              className={`${fieldClass} font-mono`}
            />
            <p className="text-xs text-zinc-500 mt-1">{t('categories.form.slugHelp', { path: '/services/[slug]' })}</p>
          </div>
          <div>
            <label htmlFor="category-category" className={labelClass}>
              {t('categories.form.category')} * <span className="text-zinc-400 normal-case tracking-normal">{t('categories.form.categoryHint')}</span>
            </label>
            <input
              id="category-category"
              type="text"
              name="category"
              required
              list="cat-list"
              maxLength={100}
              defaultValue={content?.category}
              placeholder={t('categories.form.categoryPlaceholder')}
              className={fieldClass}
            />
            <datalist id="cat-list">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('categories.form.navigationTitle')}</h2>

        <div>
          <label htmlFor="category-related" className={labelClass}>
            {t('categories.form.relatedSlugs')} <span className="text-zinc-400 normal-case tracking-normal">{t('categories.form.relatedSlugsHint')}</span>
          </label>
          <input
            id="category-related"
            type="text"
            name="relatedSlugs"
            maxLength={300}
            defaultValue={content?.relatedSlugs.join(', ')}
            placeholder="haircuts, treatments"
            className={`${fieldClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="category-order" className={labelClass}>
            {t('categories.form.displayOrder')}
          </label>
          <input
            id="category-order"
            type="number"
            name="displayOrder"
            min={0}
            max={1000}
            defaultValue={content?.displayOrder ?? 0}
            className={`${fieldClass} font-mono`}
          />
          <p className="text-xs text-zinc-500 mt-1">{t('categories.form.displayOrderHelp')}</p>
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link href="/admin/categories" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
          ← {t('categories.form.backToList')}
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? tc('actions.saving') : mode === 'create' ? t('categories.form.create') : t('categories.form.saveSettings')}
        </button>
      </div>
    </form>
  );
}
