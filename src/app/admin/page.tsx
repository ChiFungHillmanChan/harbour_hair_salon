import { verifySession } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { format, isToday, isTomorrow } from 'date-fns';

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
      date: 'asc', // Order by date ascending for a schedule view
    },
  });

  // Group appointments by date
  const groupedAppointments = appointments.reduce((acc, appt) => {
    const dateKey = format(new Date(appt.date), 'yyyy-MM-dd');
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(appt);
    return acc;
  }, {} as Record<string, typeof appointments>);

  const sortedDates = Object.keys(groupedAppointments).sort();

  return (
    <div className="min-h-screen bg-zinc-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-zinc-900">Admin Schedule</h1>
            <p className="text-zinc-600 mt-2">View and manage upcoming appointments</p>
          </div>
          <form action={logout}>
            <button className="bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-900 px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm">
              Sign Out
            </button>
          </form>
        </div>

        {sortedDates.length === 0 ? (
          <div className="bg-white shadow-sm rounded-xl p-12 text-center border border-zinc-200">
            <p className="text-zinc-500 text-lg">No upcoming bookings found.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedDates.map((dateKey) => {
              const date = new Date(dateKey);
              const dayAppointments = groupedAppointments[dateKey];
              
              let dateLabel = format(date, 'EEEE, MMMM d, yyyy');
              if (isToday(date)) dateLabel = `Today - ${dateLabel}`;
              else if (isTomorrow(date)) dateLabel = `Tomorrow - ${dateLabel}`;

              return (
                <div key={dateKey} className="bg-white shadow-sm rounded-xl overflow-hidden border border-zinc-200">
                  <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200 flex justify-between items-center">
                    <h3 className="font-semibold text-zinc-900 text-lg">
                      {dateLabel}
                    </h3>
                    <span className="text-sm text-zinc-500 font-medium bg-white px-3 py-1 rounded-full border border-zinc-200">
                      {dayAppointments.length} {dayAppointments.length === 1 ? 'Booking' : 'Bookings'}
                    </span>
                  </div>
                  
                  <div className="divide-y divide-zinc-100">
                    {dayAppointments.map((appt) => (
                      <div key={appt.id} className="p-6 hover:bg-zinc-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-6">
                          <div className="flex-shrink-0 w-20 text-center">
                            <span className="block text-lg font-bold text-zinc-900">
                              {format(new Date(appt.date), 'HH:mm')}
                            </span>
                            <span className="text-xs text-zinc-500 uppercase tracking-wider">
                              {format(new Date(appt.date), 'a')}
                            </span>
                          </div>
                          
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-base font-medium text-zinc-900">{appt.user.name}</h4>
                              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full 
                                ${appt.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' : 
                                  appt.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 
                                  appt.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 
                                  'bg-gray-100 text-gray-800'}`}>
                                {appt.status}
                              </span>
                            </div>
                            
                            <div className="text-sm text-zinc-600 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-zinc-900">{appt.service.name}</span>
                                <span className="text-zinc-400">•</span>
                                <span>{appt.service.duration} mins</span>
                                <span className="text-zinc-400">•</span>
                                <span>£{Number(appt.service.price).toFixed(2)}</span>
                              </div>
                              <div className="flex items-center gap-2 text-zinc-500">
                                <span>with</span>
                                <span className="font-medium text-zinc-700">{appt.stylist.name}</span>
                              </div>
                              <div className="text-zinc-400 text-xs pt-1">
                                {appt.user.email} {appt.user.phone && `• ${appt.user.phone}`}
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 pl-20 sm:pl-0">
                          {/* Future actions can go here like Edit/Cancel */}
                          <button className="text-sm text-zinc-500 hover:text-black underline decoration-zinc-300 underline-offset-4">
                            Details
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
