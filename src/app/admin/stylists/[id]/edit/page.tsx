import { notFound } from 'next/navigation';
import { StylistForm } from '@/components/admin/StylistForm';
import { updateStylist } from '@/app/actions/admin-stylists';
import { getStylistById } from '@/app/stylists/slug';

export const dynamic = 'force-dynamic';

export default async function EditStylistPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const stylist = await getStylistById(id);
  if (!stylist) notFound();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Edit stylist</h1>
        <p className="text-zinc-700 mt-2 font-mono text-sm">/stylists/{stylist.slug}</p>
      </div>
      <StylistForm mode="edit" action={updateStylist} stylist={stylist} saved={Boolean(saved)} />
    </div>
  );
}
