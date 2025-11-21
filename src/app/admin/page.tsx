import prisma from '@/app/lib/prisma';
import { ScheduleCalendar } from '@/components/admin/ScheduleCalendar';

export default async function AdminDashboard() {
  // Fetch all appointments for simplicity in MVP. 
  // In production, we should filter by date range based on searchParams.
  const appointments = await prisma.appointment.findMany({
    include: {
      user: true,
      stylist: true,
      service: true,
    },
    orderBy: {
      date: 'asc',
    },
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Schedule</h1>
        <p className="text-zinc-600 mt-2">Manage appointments and availability.</p>
      </div>
      
      <ScheduleCalendar appointments={appointments} />
    </div>
  );
}
