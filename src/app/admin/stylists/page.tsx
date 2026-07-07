import Link from 'next/link';
import prisma from '@/app/lib/prisma';
import { getAllStylistsWithSlug } from '@/app/stylists/slug';
import { deleteStylist } from '@/app/actions/admin-stylists';

export const dynamic = 'force-dynamic';

export default async function AdminStylistsPage() {
  const [stylists, counts] = await Promise.all([
    getAllStylistsWithSlug(),
    prisma.appointment.groupBy({
      by: ['stylistId'],
      _count: { _all: true },
    }),
  ]);

  const appointmentCount = new Map<string, number>();
  for (const row of counts) appointmentCount.set(row.stylistId, row._count._all);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">Stylists</h1>
          <p className="text-zinc-700 mt-2">
            Manage stylist bios, specialties, languages and experience shown on{' '}
            <Link href="/stylists" className="underline hover:text-zinc-900">
              the public stylists page
            </Link>
            .
          </p>
        </div>
        <Link
          href="/admin/stylists/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + New stylist
        </Link>
      </div>

      {stylists.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500 mb-6">No stylists yet.</p>
          <Link
            href="/admin/stylists/new"
            className="inline-block bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
          >
            + Add first stylist
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3">
                  Stylist
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3">
                  Role
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3">
                  Slug
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-4 py-3 w-28">
                  Bookings
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-zinc-500 font-medium px-6 py-3 w-40">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {stylists.map((s) => {
                const bookings = appointmentCount.get(s.id) ?? 0;
                return (
                  <tr key={s.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-zinc-900">{s.name}</p>
                      {s.tagline && <p className="text-xs text-zinc-500 italic mt-0.5">{s.tagline}</p>}
                    </td>
                    <td className="px-4 py-4 text-sm text-zinc-600">{s.role}</td>
                    <td className="px-4 py-4 text-xs text-zinc-500 font-mono">/{s.slug}</td>
                    <td className="px-4 py-4 text-right text-sm text-zinc-600">{bookings}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/stylists/${s.slug}`}
                          target="_blank"
                          className="text-xs font-medium text-zinc-600 hover:text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          View
                        </Link>
                        <Link
                          href={`/admin/stylists/${s.id}/edit`}
                          className="text-xs font-medium text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                        >
                          Edit
                        </Link>
                        {bookings === 0 ? (
                          <form action={deleteStylist}>
                            <input type="hidden" name="id" value={s.id} />
                            <button
                              type="submit"
                              className="text-xs font-medium px-3 py-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                            >
                              Delete
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-zinc-400 px-3 py-1.5" title="Has appointments">
                            Locked
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
