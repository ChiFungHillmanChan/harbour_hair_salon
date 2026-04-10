'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { BlogSectionEditor } from './BlogSectionEditor';
import type { BlogActionState } from '@/app/actions/admin-blog';
import type { BlogPostRuntime } from '@/app/services/blog-service';

type FormAction = (prev: BlogActionState, formData: FormData) => Promise<BlogActionState>;

interface BlogPostFormProps {
  mode: 'create' | 'edit';
  action: FormAction;
  post?: BlogPostRuntime;
  saved?: boolean;
}

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function BlogPostForm({ mode, action, post, saved }: BlogPostFormProps) {
  const [state, formAction, pending] = useActionState<BlogActionState, FormData>(action, {
    status: 'idle',
  });

  const showSavedBanner = saved || state.status === 'success';

  return (
    <form action={formAction} className="space-y-8 pb-16">
      {mode === 'edit' && post && <input type="hidden" name="id" value={post.id} />}
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

      {/* Title + slug */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Title *
          </label>
          <input
            type="text"
            name="title"
            required
            minLength={3}
            maxLength={180}
            defaultValue={post?.title}
            placeholder="e.g. How to Choose the Best Hair Salon in Leeds"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-lg font-serif focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Slug
          </label>
          <input
            type="text"
            name="slug"
            maxLength={120}
            defaultValue={post?.slug}
            placeholder="Leave blank to auto-generate from title"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
          <p className="text-xs text-zinc-500 mt-1">
            URL-friendly identifier. Will be visible at /blog/{'{'}slug{'}'}
          </p>
        </div>
      </section>

      {/* Meta */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">SEO & preview</h2>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Meta description * <span className="text-zinc-400 normal-case tracking-normal">(for Google results)</span>
          </label>
          <textarea
            name="description"
            required
            minLength={20}
            maxLength={300}
            rows={2}
            defaultValue={post?.description}
            placeholder="Short description shown in Google search results."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Excerpt * <span className="text-zinc-400 normal-case tracking-normal">(shown on the blog index)</span>
          </label>
          <textarea
            name="excerpt"
            required
            minLength={20}
            maxLength={400}
            rows={3}
            defaultValue={post?.excerpt}
            placeholder="Preview paragraph visible on the blog listing page."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Lede * <span className="text-zinc-400 normal-case tracking-normal">(opening paragraph shown in italics)</span>
          </label>
          <textarea
            name="lede"
            required
            minLength={20}
            maxLength={500}
            rows={3}
            defaultValue={post?.lede}
            placeholder="Opening sentence or two that sets the tone."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-serif italic focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      {/* Cover image */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Cover image</h2>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Cover image path *
          </label>
          <input
            type="text"
            name="coverImage"
            required
            defaultValue={post?.coverImage ?? '/images/services-hero.webp'}
            placeholder="/images/services-hero.webp"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Path to an image in /public or a full URL.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Cover alt text *
          </label>
          <input
            type="text"
            name="coverAlt"
            required
            maxLength={200}
            defaultValue={post?.coverAlt}
            placeholder="Describe the image for accessibility and SEO."
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>
      </section>

      {/* Author + publishing */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">Publishing</h2>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Author *
            </label>
            <input
              type="text"
              name="author"
              required
              maxLength={80}
              defaultValue={post?.author ?? 'The Harbour Team'}
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Author role *
            </label>
            <input
              type="text"
              name="authorRole"
              required
              maxLength={120}
              defaultValue={post?.authorRole ?? 'Harbour Hair Salon, Leeds'}
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Published date *
            </label>
            <input
              type="datetime-local"
              name="publishedAt"
              required
              defaultValue={
                post ? toDateTimeLocal(post.publishedAt) : toDateTimeLocal(new Date())
              }
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
              Reading time (minutes) *
            </label>
            <input
              type="number"
              name="readingTime"
              required
              min={1}
              max={60}
              defaultValue={post?.readingTime ?? 5}
              className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Tags <span className="text-zinc-400 normal-case tracking-normal">(comma-separated)</span>
          </label>
          <input
            type="text"
            name="tags"
            maxLength={200}
            defaultValue={post?.tags.join(', ')}
            placeholder="guides, leeds, colouring"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Related post slugs <span className="text-zinc-400 normal-case tracking-normal">(comma-separated, shown at bottom of post)</span>
          </label>
          <input
            type="text"
            name="relatedSlugs"
            maxLength={300}
            defaultValue={post?.relatedSlugs.join(', ')}
            placeholder="best-hair-salon-leeds-what-to-look-for, perm-aftercare"
            className="w-full border border-zinc-300 rounded px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
            Status *
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="status"
                value="DRAFT"
                defaultChecked={post?.status !== 'PUBLISHED'}
                className="w-4 h-4"
              />
              <span>Draft — not visible to public</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="status"
                value="PUBLISHED"
                defaultChecked={post?.status === 'PUBLISHED'}
                className="w-4 h-4"
              />
              <span>Published — visible on /blog</span>
            </label>
          </div>
        </div>
      </section>

      {/* Sections editor */}
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700 mb-2">Post body</h2>
          <p className="text-xs text-zinc-500">
            Add paragraphs, headings, bullet lists and quotes. Drag up/down to reorder.
          </p>
        </div>
        <BlogSectionEditor initial={post?.sections ?? []} />
      </section>

      {/* Submit */}
      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-zinc-50 py-4 border-t border-zinc-200">
        <Link
          href="/admin/blog"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          ← Back to list
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Create post' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
