'use client';

import { useMemo, useState, useTransition } from 'react';
import { LOCALES, type Locale } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/client';
import { clearDraft, useDraftState } from '@/i18n/draft-store';
import { formatSalonDateTime } from '@/i18n/dates';
import { CONTENT_FIELDS, type ContentEntityType, type ContentFields, type FieldSpec } from '@/app/services/content/fields';
import { evaluateDraft, type BilingualFields, type ReviewMarks } from '@/app/services/content/review';
import {
  discardContentDraftAction,
  markContentReviewedAction,
  publishContentAction,
  saveContentDraftAction,
  type ContentActionResult,
} from '@/app/actions/admin-content';

/** The serialisable part of services/content/drafts.ts EditorState. */
export type EditorSnapshot = {
  revision: number;
  working: BilingualFields;
  review: ReviewMarks;
  shared: { price?: string };
  hasDraft: boolean;
  draftUpdatedAt: string | null;
};

type SharedPrice = { value: string; editable: boolean; note?: string };

type Props =
  | { mode: 'edit'; type: ContentEntityType; entityId: string; initial: EditorSnapshot; sharedPrice?: SharedPrice }
  | { mode: 'create'; type: ContentEntityType; initial?: Partial<BilingualFields> };

const inputClass = 'w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent';

/**
 * Edits one record's customer-facing text in BOTH languages. The content
 * language tabs are independent of the admin's interface language, and
 * switching either never overwrites the other language's text.
 *
 * Edit mode: Save draft → Mark each language checked → Publish (both at once).
 * Create mode: renders inside the parent <form> and submits the two languages
 * as `contentJson` plus the `contentReviewed` confirmation; the create action
 * refuses anything incomplete, so a new item never goes live half-translated.
 *
 * Unsaved text survives an interface-language switch (in memory only).
 */
export function BilingualContentEditor(props: Props) {
  const t = useT('adminContent');
  const uiLocale = useLocale();
  const key = `content-editor:${props.type}:${props.mode === 'edit' ? props.entityId : 'new'}`;
  const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(props.mode === 'edit' ? props.initial : null);
  const emptyFields = useMemo(() => ({ 'en-GB': {}, 'zh-HK': {} }) as BilingualFields, []);
  const baseline = props.mode === 'edit' ? snapshot!.working : { ...emptyFields, ...props.initial } as BilingualFields;
  const [working, setWorking] = useDraftState<BilingualFields>(`${key}:fields`, baseline);
  const [price, setPrice] = useDraftState<string>(`${key}:price`, props.mode === 'edit' ? (snapshot!.shared.price ?? props.sharedPrice?.value ?? '') : '');
  const [tab, setTab] = useDraftState<Locale>(`${key}:tab`, 'en-GB');
  const [confirmed, setConfirmed] = useDraftState(`${key}:confirmed`, false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const specs = CONTENT_FIELDS[props.type];
  const review = snapshot?.review ?? {};
  // For the badges and buttons only; the server re-evaluates on save/publish.
  const liveStatus = evaluateDraft(props.type, working, review);
  const evaluation = props.mode === 'edit'
    ? liveStatus
    : { publishable: confirmed && LOCALES.every((locale) => liveStatus.locales[locale].complete) };
  const savedPrice = snapshot?.shared.price ?? (props.mode === 'edit' ? props.sharedPrice?.value ?? '' : '');
  const dirty = props.mode === 'edit' && (JSON.stringify(working) !== JSON.stringify(snapshot!.working) || (props.sharedPrice?.editable ? price !== savedPrice : false));

  const update = (locale: Locale, fieldKey: string, value: unknown) =>
    setWorking((current) => ({ ...current, [locale]: { ...current[locale], [fieldKey]: value } }));

  const apply = (result: ContentActionResult) => {
    if (result.ok) {
      setSnapshot(toSnapshot(result.state));
      setWorking(result.state.working);
      if (result.state.shared.price !== undefined) setPrice(result.state.shared.price);
      setMessage(result.message ? { tone: 'ok', text: result.message } : null);
      if (!result.state.hasDraft) {
        for (const suffix of ['fields', 'price', 'confirmed']) clearDraft(`${key}:${suffix}`);
      }
    } else {
      setMessage({ tone: 'error', text: result.error });
    }
  };

  const run = (task: () => Promise<ContentActionResult>) => startTransition(async () => {
    setMessage(null);
    try {
      apply(await task());
    } catch {
      setMessage({ tone: 'error', text: t('editor.errors.GENERIC') });
    }
  });

  const other = (locale: Locale): Locale => (locale === 'en-GB' ? 'zh-HK' : 'en-GB');

  return (
    <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5" aria-labelledby={`${key}-title`}>
      <div>
        <h2 id={`${key}-title`} className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('editor.title')}</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{props.mode === 'edit' ? t('editor.intro') : t('editor.createHelp')}</p>
        {props.mode === 'edit' && (
          <p className="mt-2 text-xs text-zinc-600">
            {snapshot!.revision > 0 ? t('editor.status.published', { revision: snapshot!.revision }) : t('editor.status.neverPublished')}
            {' · '}
            {dirty
              ? t('editor.status.unsaved')
              : snapshot!.hasDraft && snapshot!.draftUpdatedAt
                ? t('editor.status.draftSaved', { time: formatSalonDateTime(uiLocale, new Date(snapshot!.draftUpdatedAt)) })
                : t('editor.status.noDraft')}
          </p>
        )}
      </div>

      <div role="tablist" aria-label={t('editor.contentLanguage')} className="flex gap-2 border-b border-zinc-200">
        {LOCALES.map((locale) => {
          const status = liveStatus.locales[locale];
          return (
            <button
              key={locale}
              type="button"
              role="tab"
              id={`${key}-tab-${locale}`}
              aria-selected={tab === locale}
              aria-controls={`${key}-panel-${locale}`}
              onClick={() => setTab(locale)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === locale ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}
            >
              <span lang={locale}>{t.dynamic(`editor.tabs.${locale}`)}</span>
              <span
                aria-hidden="true"
                className={`ml-2 inline-block h-2 w-2 rounded-full ${status.complete && (props.mode === 'create' || status.reviewed) ? 'bg-emerald-500' : status.needsReview ? 'bg-amber-500' : 'bg-zinc-300'}`}
              />
            </button>
          );
        })}
      </div>

      {LOCALES.map((locale) => {
        const status = liveStatus.locales[locale];
        return (
          <div
            key={locale}
            role="tabpanel"
            id={`${key}-panel-${locale}`}
            aria-labelledby={`${key}-tab-${locale}`}
            hidden={tab !== locale}
            className="space-y-4"
          >
            <ul className="flex flex-wrap gap-2 text-xs">
              <li className={`rounded px-2 py-1 ${status.complete ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
                {status.complete ? t('editor.status.complete') : t('editor.status.missing', { fields: status.missing.map((field) => t.dynamic(`fields.${field}`, undefined, field)).join('、') })}
              </li>
              {props.mode === 'edit' && (
                <li className={`rounded px-2 py-1 ${status.reviewed ? 'bg-emerald-50 text-emerald-800' : status.needsReview ? 'bg-amber-50 text-amber-800' : 'bg-zinc-100 text-zinc-600'}`}>
                  {status.reviewed ? t('editor.status.checked') : status.needsReview ? t('editor.status.needsReview') : t('editor.status.notChecked')}
                </li>
              )}
            </ul>
            <div lang={locale} className="space-y-4">
              {specs.map((spec) => (
                <FieldEditor key={spec.key} spec={spec} value={working[locale]?.[spec.key]} onChange={(value) => update(locale, spec.key, value)} idPrefix={`${key}-${locale}`} />
              ))}
            </div>
            {props.mode === 'edit' && (
              <div className="rounded border border-zinc-200 bg-zinc-50 p-3">
                <button
                  type="button"
                  disabled={pending || dirty || !snapshot!.hasDraft || !status.complete}
                  onClick={() => run(() => markContentReviewedAction(props.type, props.entityId, locale))}
                  className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50"
                >
                  {t('editor.actions.markChecked', { language: t.dynamic(`editor.tabs.${locale}`) })}
                </button>
                <p className="mt-1 text-xs text-zinc-500">{t('editor.actions.markCheckedHelp')}</p>
                {status.reviewed === false && liveStatus.locales[other(locale)].complete === false && <span className="sr-only">{t('editor.publishBlocked')}</span>}
              </div>
            )}
          </div>
        );
      })}

      {props.mode === 'edit' && props.sharedPrice && (
        <div>
          <label htmlFor={`${key}-price`} className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">{t('editor.sharedPrice')}</label>
          <input
            id={`${key}-price`}
            type="text"
            inputMode="decimal"
            value={price}
            disabled={!props.sharedPrice.editable}
            onChange={(event) => setPrice(event.target.value)}
            className={`${inputClass} max-w-40 font-mono`}
          />
          <p className="mt-1 text-xs text-zinc-500">{props.sharedPrice.editable ? t('editor.sharedPriceHelp') : props.sharedPrice.note}</p>
        </div>
      )}

      {props.mode === 'create' ? (
        <div className="space-y-2">
          <input type="hidden" name="contentJson" value={JSON.stringify(working)} />
          <label className="flex items-start gap-3 text-sm text-zinc-700">
            <input type="checkbox" name="contentReviewed" data-no-preserve checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>{t('editor.createConfirm')}</span>
          </label>
          {!evaluation.publishable && <p className="text-xs text-zinc-500">{t('editor.publishBlocked')}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4">
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={() => run(() => saveContentDraftAction(props.type, props.entityId, working, props.sharedPrice?.editable ? { price } : undefined))}
            className="rounded bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {pending ? t('editor.actions.saving') : t('editor.actions.saveDraft')}
          </button>
          <button
            type="button"
            disabled={pending || dirty || !snapshot!.hasDraft || !evaluation.publishable}
            onClick={() => run(() => publishContentAction(props.type, props.entityId))}
            className="rounded border border-zinc-900 px-5 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-50"
          >
            {pending ? t('editor.actions.publishing') : t('editor.actions.publish')}
          </button>
          {snapshot!.hasDraft && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(t('editor.actions.discardConfirm'))) run(() => discardContentDraftAction(props.type, props.entityId));
              }}
              className="text-sm text-zinc-600 underline hover:text-zinc-900 disabled:opacity-50"
            >
              {t('editor.actions.discard')}
            </button>
          )}
          <p className="w-full text-xs text-zinc-500">{evaluation.publishable && !dirty ? t('editor.publishHelp') : t('editor.publishBlocked')}</p>
        </div>
      )}

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function toSnapshot(state: EditorSnapshot): EditorSnapshot {
  return { revision: state.revision, working: state.working, review: state.review, shared: state.shared, hasDraft: state.hasDraft, draftUpdatedAt: state.draftUpdatedAt };
}

function FieldEditor({ spec, value, onChange, idPrefix }: { spec: FieldSpec; value: unknown; onChange: (value: unknown) => void; idPrefix: string }) {
  const t = useT('adminContent');
  const id = `${idPrefix}-${spec.key}`;
  const label = (
    <label htmlFor={id} className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-1">
      {t.dynamic(`fields.${spec.key}`, undefined, spec.key)}{spec.required ? ' *' : ''}
    </label>
  );
  switch (spec.kind) {
    case 'text':
      return <div>{label}<input id={id} type="text" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} className={inputClass} /></div>;
    case 'longtext':
      return <div>{label}<textarea id={id} rows={3} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} className={inputClass} /></div>;
    case 'stringList':
      return (
        <div>
          {label}
          <textarea
            id={id}
            rows={4}
            value={Array.isArray(value) ? (value as string[]).join('\n') : ''}
            onChange={(event) => onChange(event.target.value.split('\n'))}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">{t('editor.listHint')}</p>
        </div>
      );
    case 'steps':
    case 'qaList': {
      const [a, b] = spec.kind === 'steps' ? ['step', 'detail'] as const : ['question', 'answer'] as const;
      const rows = (Array.isArray(value) ? value : []) as Record<string, string>[];
      const set = (index: number, field: string, text: string) => onChange(rows.map((row, i) => (i === index ? { ...row, [field]: text } : row)));
      return (
        <fieldset>
          <legend className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-1">{t.dynamic(`fields.${spec.key}`, undefined, spec.key)}</legend>
          <ol className="space-y-3">
            {rows.map((row, index) => (
              <li key={index} className="rounded border border-zinc-200 p-3 space-y-2">
                <input aria-label={t.dynamic(`fields.${a}`)} type="text" value={row[a] ?? ''} onChange={(event) => set(index, a, event.target.value)} className={inputClass} />
                <textarea aria-label={t.dynamic(`fields.${b}`)} rows={2} value={row[b] ?? ''} onChange={(event) => set(index, b, event.target.value)} className={inputClass} />
                <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== index))} className="text-xs text-zinc-600 underline">{t('editor.actions.removeItem')}</button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => onChange([...rows, { [a]: '', [b]: '' }])} className="mt-2 text-sm text-zinc-800 underline">{t('editor.actions.addItem')}</button>
        </fieldset>
      );
    }
    case 'blogSections':
      return <BlogSectionsField value={value} onChange={onChange} legend={t.dynamic(`fields.${spec.key}`)} />;
  }
}

type Section = { type: 'paragraph' | 'heading' | 'list' | 'quote'; text?: string; level?: 2 | 3; items?: string[]; attribution?: string };

function BlogSectionsField({ value, onChange, legend }: { value: unknown; onChange: (value: unknown) => void; legend: string }) {
  const t = useT('adminContent');
  const sections = (Array.isArray(value) ? value : []) as Section[];
  const set = (index: number, next: Section) => onChange(sections.map((section, i) => (i === index ? next : section)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <fieldset>
      <legend className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-1">{legend}</legend>
      <ol className="space-y-3">
        {sections.map((section, index) => (
          <li key={index} className="rounded border border-zinc-200 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={legend}
                value={section.type === 'heading' ? `heading-${section.level ?? 2}` : section.type}
                onChange={(event) => {
                  const choice = event.target.value;
                  if (choice.startsWith('heading')) set(index, { type: 'heading', level: choice === 'heading-3' ? 3 : 2, text: section.text ?? '' });
                  else if (choice === 'list') set(index, { type: 'list', items: section.items ?? (section.text ? [section.text] : []) });
                  else set(index, { type: choice as Section['type'], text: section.text ?? section.items?.join('\n') ?? '' });
                }}
                className="border border-zinc-300 rounded px-2 py-1 text-sm"
              >
                <option value="paragraph">¶</option>
                <option value="heading-2">H2</option>
                <option value="heading-3">H3</option>
                <option value="list">•</option>
                <option value="quote">“ ”</option>
              </select>
              <button type="button" onClick={() => move(index, -1)} className="text-xs underline">{t('editor.actions.moveUp')}</button>
              <button type="button" onClick={() => move(index, 1)} className="text-xs underline">{t('editor.actions.moveDown')}</button>
              <button type="button" onClick={() => onChange(sections.filter((_, i) => i !== index))} className="text-xs underline">{t('editor.actions.removeItem')}</button>
            </div>
            {section.type === 'list' ? (
              <textarea aria-label={legend} rows={3} value={(section.items ?? []).join('\n')} onChange={(event) => set(index, { type: 'list', items: event.target.value.split('\n') })} className={inputClass} />
            ) : (
              <textarea aria-label={legend} rows={section.type === 'paragraph' ? 4 : 2} value={section.text ?? ''} onChange={(event) => set(index, { ...section, text: event.target.value })} className={inputClass} />
            )}
            {section.type === 'quote' && (
              <input
                aria-label={t('fields.attribution')}
                placeholder={t('fields.attribution')}
                type="text"
                value={section.attribution ?? ''}
                onChange={(event) => set(index, { ...section, attribution: event.target.value || undefined })}
                className={inputClass}
              />
            )}
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...sections, { type: 'paragraph', text: '' }])} className="mt-2 text-sm text-zinc-800 underline">{t('editor.actions.addItem')}</button>
    </fieldset>
  );
}

export type { ContentFields };
