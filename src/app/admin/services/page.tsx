import Link from 'next/link';
import prisma from '@/app/lib/prisma';
import { deleteService } from '@/app/actions/admin-services';

export const dynamic = 'force-dynamic';

async function getServicesGrouped() {
  const services = await prisma.service.findMany({
    orderBy: [{ category: 'asc' }, { price: 'asc' }],
    include: { _count: { select: { appointments: true } } },
  });

  const grouped = new Map<string, typeof services>();
  for (const s of services) {
    const bucket = grouped.get(s.category) ?? [];
    bucket.push(s);
    grouped.set(s.category, bucket);
  }

  return { services, grouped };
}

export default async function AdminServicesPage() {
  const { services, grouped } = await getServicesGrouped();

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-8 gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">Services & Pricing</h1>
          <p className="text-zinc-700 mt-2">
            Add, edit and remove services. Changes appear on{' '}
            <Link href="/services" className="underline hover:text-zinc-900">
              the public services page
            </Link>{' '}
            within a few seconds.
          </p>
        </div>
        <Link
          href="/admin/services/new"
          className="shrink-0 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
        >
          + New service
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Total services</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{services.length}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Categories</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{grouped.size}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Avg price</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">
            £
            {services.length > 0
              ? (
                  services.reduce((sum, s) => sum + Number(s.price), 0) / services.length
                ).toFixed(2)
              : '0.00'}
          </p>
        </div>
      </div>

      {services.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center">
          <p className="text-zinc-500 mb-6">No services yet. Add your first one.</p>
          <Link
            href="/admin/services/new"
            className="inline-block bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 text-sm uppercase tracking-[0.15em] font-bold transition-colors rounded"
          >
            + New service
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="bg-white border border-zinc-200 rounded-lg overflow-x-auto">
              <div className="bg-zinc-50 border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-700">
                  {category}
                </h2>
                <span className="text-xs text-zinc-500">{items.length} services</span>
              </div>
              <table className="w-full">
                <thead className="border-b border-zinc-100">
                  <tr>
                    <th className="text-left text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-6 py-2">
                      Name
                    </th>
                    <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2 w-24">
                      Price
                    </th>
                    <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2 w-24">
                      Duration
                    </th>
                    <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-4 py-2 w-28">
                      Bookings
                    </th>
                    <th className="text-right text-[11px] uppercase tracking-wider text-zinc-500 font-medium px-6 py-2 w-40">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {items.map((service) => {
                    const bookings = service._count.appointments;
                    return (
                      <tr key={service.id} className="hover:bg-zinc-50">
                        <td className="px-6 py-3">
                          <div>
                            <p className="font-medium text-zinc-900 text-sm">{service.name}</p>
                            {service.description && (
                              <p className="text-xs text-zinc-500 mt-0.5">{service.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-zinc-900">
                          £{Number(service.price).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-zinc-600">
                          {service.duration} min
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-zinc-600">
                          {bookings}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/admin/services/${service.id}/edit`}
                              className="text-xs font-medium text-zinc-900 px-3 py-1.5 rounded hover:bg-zinc-100 transition-colors"
                            >
                              Edit
                            </Link>
                            {bookings === 0 ? (
                              <form action={deleteService}>
                                <input type="hidden" name="id" value={service.id} />
                                <button
                                  type="submit"
                                  className="text-xs font-medium px-3 py-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                                >
                                  Delete
                                </button>
                              </form>
                            ) : (
                              <span
                                className="text-xs text-zinc-400 px-3 py-1.5"
                                title="Cannot delete — service has appointments"
                              >
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
          ))}
        </div>
      )}
    </div>
  );
}
