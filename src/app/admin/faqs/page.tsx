import Link from 'next/link';
import { getAllFaqs, getAllFaqKeys } from '@/app/services/faq-service';
import { deleteFaq, updateFaq, type FaqActionState } from '@/app/actions/admin-faqs';
import { FaqInlineEditor } from '@/components/admin/FaqInlineEditor';

export const dynamic = 'force-dynamic';

const KEY_LABELS: Record<string, string> = {
  home: 'Home page',
  contact: 'Contact page',
  'services-master': 'Services master page',
};

function labelForKey(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (key.startsWith('category:')) return `Category page (${key.slice('category:'.length)})`;
  return key;
}

export default async function AdminFaqsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; key?: string }>;
}) {
  const { saved, key: focusKey } = await searchParams;
  const [faqs, keys] = await Promise.all([getAllFaqs(), getAllFaqKeys()]);

  const grouped = new Map<string, typeof faqs>();
  for (const f of faqs) {
    const bucket = grouped.get(f.key) ?? [];
    bucket.push(f);
    grouped.set(f.key, bucket);
  }

  const updateFaqAction: (
    _prev: FaqActionState,
    formData: FormData
  ) => Promise<FaqActionState> = updateFaq;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-zinc-900">FAQs</h1>
          <p className="text-zinc-700 mt-2">
            Manage the FAQ blocks shown on the home, services, contact and category pages. Each
            page reads FAQs by a key (e.g. <code className="bg-zinc-100 px-1 rounded">home</code>).
          </p>
        </div>
        <Link
          href="/admin/faqs/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + New FAQ
        </Link>
      </div>

      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm mb-6">
          ✓ Saved successfully.
        </div>
      )}

      {keys.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2 text-xs">
          <span className="text-zinc-500 uppercase tracking-wider font-medium mr-2">
            Existing keys:
          </span>
          {keys.map((k) => (
            <span
              key={k}
              className={`inline-block px-2 py-1 rounded border ${
                focusKey === k
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white border-zinc-200 text-zinc-600'
              }`}
            >
              {k}
            </span>
          ))}
        </div>
      )}

      {grouped.size === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500">No FAQs yet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([key, items]) => (
            <section key={key} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between bg-zinc-50 border-b border-zinc-200 px-6 py-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-700">
                  {labelForKey(key)}
                </h2>
                <span className="text-xs text-zinc-500 font-mono">{key}</span>
              </div>
              <ul className="divide-y divide-zinc-100">
                {items.map((faq) => (
                  <li key={faq.id} className="p-6">
                    <FaqInlineEditor faq={faq} action={updateFaqAction} />
                    <div className="mt-3 flex justify-end">
                      <form action={deleteFaq}>
                        <input type="hidden" name="id" value={faq.id} />
                        <button
                          type="submit"
                          className="text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
