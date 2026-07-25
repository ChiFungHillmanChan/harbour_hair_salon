'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addDays, isToday, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';
import { Appointment, Service, Stylist } from '@prisma/client';

type AppointmentWithDetails = Appointment & {
  user: { id: string; name: string | null; email: string };
  service: Pick<Service, 'name' | 'duration' | 'price'>;
  stylist: Pick<Stylist, 'name'>;
};

type ViewMode = 'day' | 'month' | 'year';

const statusChipClass = (status: string) =>
  status === 'CONFIRMED'
    ? 'bg-green-100 text-green-700'
    : status === 'PENDING'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-zinc-100 text-zinc-600';

async function setAppointmentStatus(
  apptId: string,
  status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED',
  onDone: () => void,
) {
  const { updateAppointmentStatus } = await import('@/app/actions/admin');
  const res = await updateAppointmentStatus(apptId, status);
  if (res.success) { onDone(); } else { alert(res.error ?? 'Failed to update'); }
}

// Approve / decline buttons for a PENDING booking request (double-confirm flow:
// customers submit requests, the salon confirms them here).
const PendingActions = ({ apptId, onDone }: { apptId: string; onDone: () => void }) => (
  <div className="flex gap-2">
    <button
      type="button"
      onClick={() => setAppointmentStatus(apptId, 'CONFIRMED', onDone)}
      className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
    >
      Confirm booking
    </button>
    <button
      type="button"
      onClick={() => {
        if (window.confirm('Decline this booking request? The customer will need to book again.')) {
          setAppointmentStatus(apptId, 'CANCELLED', onDone);
        }
      }}
      className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
    >
      Decline
    </button>
  </div>
);

interface YearViewProps {
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  setViewMode: (mode: ViewMode) => void;
  appointments: AppointmentWithDetails[];
}

const YearView = ({ currentDate, setCurrentDate, setViewMode, appointments }: YearViewProps) => {
  const yearStart = startOfYear(currentDate);
  const yearEnd = endOfYear(currentDate);
  const months = eachMonthOfInterval({ start: yearStart, end: yearEnd });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {months.map((month) => {
          const monthAppointments = appointments.filter(a => isSameMonth(new Date(a.date), month));
          return (
            <button 
              key={month.toString()} 
              onClick={() => {
                setCurrentDate(month);
                setViewMode('month');
              }}
              className="bg-white p-4 rounded-lg shadow hover:bg-zinc-50 text-left border border-zinc-200"
            >
              <h3 className="font-bold text-zinc-900">{format(month, 'MMMM')}</h3>
              <p className="text-sm text-zinc-700">{monthAppointments.length} bookings</p>
            </button>
          );
      })}
    </div>
  );
};

interface MonthViewProps {
  currentDate: Date;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  getDayAppointments: (date: Date) => AppointmentWithDetails[];
}

const MonthView = ({ currentDate, selectedDate, setSelectedDate, getDayAppointments }: MonthViewProps) => {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
        {weekDays.map(day => (
          <div key={day} className="py-2 text-center text-xs font-bold text-zinc-700 uppercase tracking-wide">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const dayAppts = getDayAppointments(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isSelected = isSameDay(day, selectedDate);
          const isTodayDate = isToday(day);

          return (
            <div 
              key={day.toString()}
              onClick={() => {
                setSelectedDate(day);
              }}
              className={`min-h-[100px] p-2 border-b border-r border-zinc-100 cursor-pointer transition-colors
                ${!isCurrentMonth ? 'bg-zinc-100 text-zinc-400' : 'bg-white text-zinc-900'}
                ${isSelected ? 'bg-zinc-100 ring-1 ring-inset ring-zinc-900' : !isCurrentMonth ? 'hover:bg-zinc-200/70' : 'hover:bg-zinc-50'}
              `}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full
                  ${isTodayDate ? 'bg-red-500 text-white' : isCurrentMonth ? 'text-zinc-900' : 'text-zinc-400'}
                `}>
                  {format(day, 'd')}
                </span>
                {dayAppts.length > 0 && (
                  <span className="text-[10px] bg-zinc-200 text-zinc-600 px-1.5 rounded-full">
                    {dayAppts.length}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {dayAppts.slice(0, 3).map(appt => (
                  <div
                    key={appt.id}
                    className={`text-[10px] truncate text-white rounded px-1 py-0.5 ${appt.status === 'PENDING' ? 'bg-amber-600' : 'bg-zinc-800'}`}
                  >
                    {format(new Date(appt.date), 'HH:mm')} {appt.user.name}
                  </div>
                ))}
                {dayAppts.length > 3 && (
                  <div className="text-[10px] text-zinc-400 pl-1">
                    + {dayAppts.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface DayViewProps {
  currentDate: Date;
  dayAppts: AppointmentWithDetails[];
  onRefresh: () => void;
}

const DayView = ({ currentDate, dayAppts, onRefresh }: DayViewProps) => {
  return (
    <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden flex flex-col">
      <div className="p-4 border-b border-zinc-200 bg-zinc-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">{format(currentDate, 'EEEE, MMMM d')}</h3>
          <span className="text-sm text-zinc-500">{dayAppts.length} appointments</span>
      </div>
      <div className="divide-y divide-zinc-100 overflow-y-auto max-h-[600px]">
          {dayAppts.length === 0 ? (
              <div className="p-12 text-center text-zinc-500">No appointments for this day.</div>
          ) : (
              dayAppts.map(appt => (
                  <div key={appt.id} className="flex p-4 hover:bg-zinc-50 group">
                      <div className="w-20 flex-shrink-0 text-zinc-700 text-sm pt-1 font-medium">
                          {format(new Date(appt.date), 'HH:mm')}
                      </div>
                      <div className="flex-1 bg-zinc-50 rounded-lg p-3 border border-zinc-200 group-hover:border-zinc-300 transition-colors">
                          <div className="flex justify-between items-start">
                              <div>
                                  <h4 className="font-semibold text-zinc-900">{appt.user.name}</h4>
                                  <p className="text-zinc-600 text-sm">{appt.service.name} • {appt.service.duration} mins</p>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusChipClass(appt.status)}`}>
                                  {appt.status}
                              </span>
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
                              <span>Stylist: {appt.stylist.name}</span>
                              <span>£{Number(appt.service.price).toFixed(2)}</span>
                          </div>
                          {appt.status === 'PENDING' && (
                            <div className="mt-2">
                              <PendingActions apptId={appt.id} onDone={onRefresh} />
                            </div>
                          )}
                          {appt.status === 'CONFIRMED' && (
                            <button
                              type="button"
                              onClick={() => setAppointmentStatus(appt.id, 'COMPLETED', onRefresh)}
                              className="mt-2 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                            >
                              Mark completed
                            </button>
                          )}
                      </div>
                  </div>
              ))
          )}
      </div>
    </div>
  );
};

export function ScheduleCalendar({ appointments }: { appointments: AppointmentWithDetails[] }) {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Navigation Handlers
  const next = () => {
    if (viewMode === 'day') setCurrentDate(addDays(currentDate, 1));
    else if (viewMode === 'month') setCurrentDate(addMonths(currentDate, 1));
    else setCurrentDate(addMonths(currentDate, 12)); // Year jump
  };

  const prev = () => {
    if (viewMode === 'day') setCurrentDate(addDays(currentDate, -1));
    else if (viewMode === 'month') setCurrentDate(subMonths(currentDate, 1));
    else setCurrentDate(subMonths(currentDate, 12));
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDate(now);
  };

  // Filter appointments for the current view
  const getDayAppointments = (date: Date) => {
    return appointments.filter(appt => isSameDay(new Date(appt.date), date));
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-lg shadow border border-zinc-200">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md shadow-sm" role="group">
            <button onClick={() => setViewMode('day')} className={`px-4 py-2 text-sm font-medium border border-gray-200 rounded-l-lg ${viewMode === 'day' ? 'bg-zinc-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>
              Day
            </button>
            <button onClick={() => setViewMode('month')} className={`px-4 py-2 text-sm font-medium border-t border-b border-gray-200 ${viewMode === 'month' ? 'bg-zinc-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>
              Month
            </button>
            <button onClick={() => setViewMode('year')} className={`px-4 py-2 text-sm font-medium border border-gray-200 rounded-r-lg ${viewMode === 'year' ? 'bg-zinc-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>
              Year
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={prev} className="p-2 hover:bg-zinc-100 rounded-full">
             ←
          </button>
          <h2 className="text-xl font-bold min-w-[200px] text-center">
            {viewMode === 'year' ? format(currentDate, 'yyyy') : format(currentDate, 'MMMM yyyy')}
          </h2>
          <button onClick={next} className="p-2 hover:bg-zinc-100 rounded-full">
             →
          </button>
        </div>

        <button onClick={goToToday} className="text-sm font-medium text-zinc-900 hover:underline">
          Today
        </button>
      </div>

      {/* Content */}
      <div>
        {viewMode === 'year' && (
          <YearView 
            currentDate={currentDate}
            setCurrentDate={setCurrentDate}
            setViewMode={setViewMode}
            appointments={appointments}
          />
        )}
        {viewMode === 'month' && (
          <MonthView 
            currentDate={currentDate}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            getDayAppointments={getDayAppointments}
          />
        )}
        {viewMode === 'day' && (
          <DayView
            currentDate={currentDate}
            dayAppts={getDayAppointments(currentDate)}
            onRefresh={() => router.refresh()}
          />
        )}
      </div>
      
      {viewMode === 'month' && (
         <div className="mt-6">
             <h3 className="text-lg font-bold mb-4">Selected Date: {format(selectedDate, 'MMM d, yyyy')}</h3>
             <div className="bg-white rounded-lg shadow border border-zinc-200 p-6">
                 {getDayAppointments(selectedDate).length > 0 ? (
                     <div className="space-y-4">
                         {getDayAppointments(selectedDate).map(appt => (
                             <div key={appt.id} className="flex justify-between items-center border-b border-zinc-100 last:border-0 pb-2 last:pb-0">
                                 <div>
                                     <p className="font-medium text-zinc-900">{format(new Date(appt.date), 'HH:mm')} - {appt.user.name}</p>
                                     <p className="text-sm text-zinc-500">{appt.service.name} with {appt.stylist.name}</p>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <div className={`text-xs px-2 py-1 rounded font-medium ${statusChipClass(appt.status)}`}>
                                         {appt.status}
                                     </div>
                                     {appt.status === 'PENDING' && (
                                       <PendingActions apptId={appt.id} onDone={() => router.refresh()} />
                                     )}
                                     {appt.status === 'CONFIRMED' && (
                                       <button
                                         type="button"
                                         onClick={() => setAppointmentStatus(appt.id, 'COMPLETED', () => router.refresh())}
                                         className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                                       >
                                         Mark completed
                                       </button>
                                     )}
                                 </div>
                             </div>
                         ))}
                     </div>
                 ) : (
                     <p className="text-zinc-500">No appointments selected.</p>
                 )}
             </div>
         </div>
      )}
    </div>
  );
}