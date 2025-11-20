import { verifySession } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { format } from 'date-fns';

export default async function AdminDashboard() {
  const session = await verifySession();

  if (session.role !== 'ADMIN') {
    redirect('/');
  }

  const appointments = await prisma.appointment.findMany({
    include: {
      user: true,
      stylist: true,
      service: true,
    },
    orderBy: {
      date: 'desc',
    },
  });

  return (
    <div className="min-h-screen bg-zinc-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-zinc-900">Admin Dashboard</h1>
            <p className="text-zinc-600 mt-2">Manage salon appointments and bookings</p>
          </div>
          <form action={logout}>
            <button className="bg-zinc-200 hover:bg-zinc-300 text-zinc-900 px-4 py-2 rounded-md text-sm font-medium transition-colors">
              Sign Out
            </button>
          </form>
        </div>

        <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-zinc-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200">
              <thead className="bg-zinc-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Stylist
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Service
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-zinc-200">
                {appointments.map((appt) => (
                  <tr key={appt.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900">
                      {format(new Date(appt.date), 'PPP')}
                      <br />
                      <span className="text-zinc-500">{format(new Date(appt.date), 'p')}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-zinc-900">{appt.user.name}</div>
                      <div className="text-sm text-zinc-500">{appt.user.email}</div>
                      {appt.user.phone && <div className="text-xs text-zinc-400">{appt.user.phone}</div>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900">
                      {appt.stylist.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900">
                      {appt.service.name}
                      <span className="text-xs text-zinc-500 block">{appt.service.duration} mins</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                        ${appt.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' : 
                          appt.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 
                          appt.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 
                          'bg-gray-100 text-gray-800'}`}>
                        {appt.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900">
                      £{Number(appt.service.price).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {appointments.length === 0 && (
            <div className="p-12 text-center text-zinc-500">
              No bookings found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

