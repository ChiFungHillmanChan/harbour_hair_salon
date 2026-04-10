'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { CategoryActionState } from '@/app/actions/admin-categories';
import type {
  ServiceCategoryContentRuntime,
  ProcessStep,
  CategoryFaq,
} from '@/app/services/category-content-service';

type FormAction = (prev: CategoryActionState, formData: FormData) => Promise<CategoryActionState>;

interface CategoryContentFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  content?: ServiceCategoryContentRuntime;
  saved?: boolean;
  existingCategories: string[];
}

function TextareaList({
  label,
  name,
  initial,
  placeholder,
  help,
}: {
  label: string;
  name: string;
  initial: string[];
  placeholder: string;
  help?: string;
}) {
  const [text, setText] = useState(initial.join('\n'));
  const parsed = text.split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
        {label} <span className="text-zinc-400 normal-case tracking-normal">(one per line)</span>
      </label>
      <input type="hidden" name={name} value={JSON.stringify(parsed)} />
      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
      />
      {help && <p className="text-xs text-zinc-500 mt-1">{help}</p>}
      <p className="text-xs text-zinc-400 mt-1">{parsed.length} entries</p>
    </div>
  );
}

function ProcessStepsEditor({ initial }: { initial: ProcessStep[] }) {
  const [steps, setSteps] = useState<ProcessStep[]>(
    initial.length > 0 ? initial : [{ step: '', detail: '' }]
  );

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
        Process steps <span className="text-zinc-400 normal-case tracking-normal">(what to expect)</span>
      </label>
      <input type="hidden" name="processJson" value={JSON.stringify(steps.filter((s) => s.step && s.detail))} />

      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="bg-white border border-zinc-200 rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">
                Step {i + 1}
              </span>
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              type="text"
              value={s.step}
              onChange={(e) =>
                setSteps(steps.map((item, j) => (j === i ? { ...item, step: e.target.value } : item)))
              }
              placeholder="Step name (e.g. Consultation)"
              className="w-full border border-zinc-300 rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <textarea
              rows={2}
              value={s.detail}
              onChange={(e) =>
                setSteps(
                  steps.map((item, j) => (j === i ? { ...item, detail: e.target.value } : item))
                )
              }
              placeholder="Step detail (what happens at this step)"
              className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setSteps([...steps, { step: '', detail: '' }])}
        className="mt-3 text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-dashed border-zinc-300 px-3 py-2 rounded"
      >
        + Add step
      </button>
    </div>
  );
}

function FaqsEditor({ initial }: { initial: CategoryFaq[] }) {
  const [faqs, setFaqs] = useState<CategoryFaq[]>(
    initial.length > 0 ? initial : [{ question: '', answer: '' }]
  );

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
        FAQs <span className="text-zinc-400 normal-case tracking-normal">(emits FAQPage schema)</span>
      </label>
      <input type="hidden" name="faqsJson" value={JSON.stringify(faqs.filter((f) => f.question && f.answer))} />

      <div className="space-y-3">
        {faqs.map((f, i) => (
          <div key={i} className="bg-white border border-zinc-200 rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">
                FAQ {i + 1}
              </span>
              {faqs.length > 1 && (
                <button
                  type="button"
                  onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              type="text"
              value={f.question}
              onChange={(e) =>
                setFaqs(
                  faqs.map((item, j) => (j === i ? { ...item, question: e.target.value } : item))
                )
              }
              placeholder="Question"
              className="w-full border border-zinc-300 rounded px-3 py-2 text-sm font-medium mb-2 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <textarea
              rows={3}
              value={f.answer}
              onChange={(e) =>
                setFaqs(
                  faqs.map((item, j) => (j === i ? { ...item, answer: e.target.value } : item))
                )
              }
              placeholder="Answer"
              className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setFaqs([...faqs, { question: '', answer: '' }])}
        className="mt-3 text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-dashed border-zinc-300 px-3 py-2 rounded"
      >
        + Add FAQ
      </button>
    </div>
  );
}

export function CategoryContentForm({
  mode,
  action,
  content,
  saved,
  existingCategories,
}: CategoryContentFormProps) {
  const [state, formAction, pending] = useActionState<CategoryActionState, FormData>(action, {
    status: 'idle',
  });

  const showSavedBanner = saved || state.status === 'success';

  return (
    <form action={formAction} className="space-y-6 pb-16">
      {mode === 'edit' && content && <input type="hidden" name="id" value={content.id} />}

      {showSavedBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm">
          ✓ Saved successfully.
        </div>
      )}
      {state.status === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
          {state.message}
        </div>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Identity</h2>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Slug * <span className="text-zinc-400 normal-case tracking-normal">(URL segment)</span>
            </label>
            <input
              type="text"
              name="slug"
              required
              minLength={2}
              maxLength={100}
              defaultValue={content?.slug}
              placeholder="e.g. haircuts"
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
            <p className="text-xs text-zinc-500 mt-1">Will be visible at /services/{'{'}slug{'}'}</p>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Category * <span className="text-zinc-400 normal-case tracking-normal">(matches Service.category exactly)</span>
            </label>
            <input
              type="text"
              name="category"
              required
              list="cat-list"
              maxLength={100}
              defaultValue={content?.category}
              placeholder="e.g. Haircuts"
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
            <datalist id="cat-list">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            SEO title *
          </label>
          <input
            type="text"
            name="title"
            required
            minLength={3}
            maxLength={180}
            defaultValue={content?.title}
            placeholder="e.g. Haircuts in Leeds City Centre"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-base font-serif focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Hero highlight *
          </label>
          <input
            type="text"
            name="hero"
            required
            maxLength={120}
            defaultValue={content?.hero}
            placeholder="e.g. Precision Haircuts"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Main headline word(s) — rendered as &quot;[hero] in Leeds&quot; on the page.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Meta description *
          </label>
          <textarea
            name="metaDescription"
            required
            minLength={20}
            maxLength={300}
            rows={2}
            defaultValue={content?.metaDescription}
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Intro paragraph *
          </label>
          <textarea
            name="intro"
            required
            minLength={20}
            maxLength={500}
            rows={3}
            defaultValue={content?.intro}
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Content blocks</h2>

        <TextareaList
          label="Overview paragraphs"
          name="overviewJson"
          initial={content?.overview ?? []}
          placeholder="One paragraph per line..."
          help="Long-form copy shown below the hero."
        />

        <TextareaList
          label="What's included (bullets)"
          name="includesJson"
          initial={content?.includes ?? []}
          placeholder="A one-to-one consultation&#10;A warm wash&#10;..."
        />

        <ProcessStepsEditor initial={content?.process ?? []} />

        <TextareaList
          label="Aftercare tips"
          name="aftercareJson"
          initial={content?.aftercare ?? []}
          placeholder="Wait 24 hours before washing&#10;..."
        />

        <FaqsEditor initial={content?.faqs ?? []} />
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Navigation & order</h2>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Related category slugs <span className="text-zinc-400 normal-case tracking-normal">(comma-separated)</span>
          </label>
          <input
            type="text"
            name="relatedSlugs"
            maxLength={300}
            defaultValue={content?.relatedSlugs.join(', ')}
            placeholder="haircuts, treatments"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Display order
          </label>
          <input
            type="number"
            name="displayOrder"
            min={0}
            max={1000}
            defaultValue={content?.displayOrder ?? 0}
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
          <p className="text-xs text-zinc-500 mt-1">Lower numbers appear first in listings.</p>
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link href="/admin/categories" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
          ← Back to list
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Create category page' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
