import Link from 'next/link';
import { createFaq } from '@/app/actions/admin-faqs';
import { getAllFaqKeys } from '@/app/services/faq-service';
import { NewFaqForm } from '@/components/admin/NewFaqForm';

export const dynamic = 'force-dynamic';

export default async function NewFaqPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key: presetKey } = await searchParams;
  const existingKeys = await getAllFaqKeys();

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">New FAQ</h1>
        <p className="text-zinc-700 mt-2">
          Add an FAQ to a page. Use an existing key like{' '}
          <code className="bg-zinc-100 px-1 rounded">home</code> or a category-scoped one like{' '}
          <code className="bg-zinc-100 px-1 rounded">category:haircuts</code>.
        </p>
      </div>
      <NewFaqForm action={createFaq} existingKeys={existingKeys} presetKey={presetKey} />
      <div className="mt-6">
        <Link href="/admin/faqs" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← Back to list
        </Link>
      </div>
    </div>
  );
}
