import { StylistForm } from '@/components/admin/StylistForm';
import { createStylist } from '@/app/actions/admin-stylists';

export const dynamic = 'force-dynamic';

export default function NewStylistPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">New stylist</h1>
        <p className="text-zinc-700 mt-2">Add a stylist to the team.</p>
      </div>
      <StylistForm mode="create" action={createStylist} />
    </div>
  );
}
