import { requireAdmin } from '@/app/lib/session';
import Link from 'next/link';
import prisma from '@/app/lib/prisma';
import EmployeeForm, { EmployeePinReset } from '@/components/admin/EmployeeForm';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { createEmployee, resetEmployeePin, setEmployeeActive } from '@/app/actions/employees';
import KioskSessions from '@/components/admin/KioskSessions';
import { listKioskSessions } from '@/app/actions/kiosk';
import KioskModeButton from '@/components/admin/KioskModeButton';

export const dynamic = 'force-dynamic';

export default async function AdminEmployeesPage() {
  await requireAdmin();
  const [employees, stylists, kiosks] = await Promise.all([
    prisma.employee.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, title: true, payType: true, stylistId: true, isActive: true, stylist: { select: { name: true } } } }),
    prisma.stylist.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listKioskSessions(),
  ]);

  const linkedStylistIds = employees
    .map((e) => e.stylistId)
    .filter((id): id is string => Boolean(id));

  return (
    <div className="p-4 sm:p-6 space-y-8">
      <h1 className="font-serif text-2xl sm:text-3xl text-zinc-900">Employees</h1>
      <KioskModeButton />
      <KioskSessions sessions={kiosks} />

      <section>
        <h2 className="text-xl mb-3">Add employee</h2>
        <EmployeeForm action={createEmployee} stylists={stylists} linkedStylistIds={linkedStylistIds} />
      </section>

      <section>
        <h2 className="text-xl mb-3">Team</h2>
        <p className="text-sm text-zinc-600 mb-3">
          Edit pay details, set a new clock-in PIN, or deactivate someone who has left. Deactivated
          staff keep their past timesheets but can no longer clock in.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Name</th><th className="p-2">Title</th><th className="p-2">Pay type</th>
                <th className="p-2">Stylist link</th><th className="p-2">Status</th><th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b align-top">
                  <td className="p-2">{e.name}</td>
                  <td className="p-2">{e.title}</td>
                  <td className="p-2">{e.payType}</td>
                  <td className="p-2">{e.stylist?.name ?? '—'}</td>
                  <td className="p-2">
                    {e.isActive ? (
                      'Active'
                    ) : (
                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-200 text-zinc-700 rounded-full">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Link
                        href={`/admin/employees/${e.id}/edit`}
                        className="text-sm text-zinc-700 hover:text-zinc-900 font-medium underline"
                      >
                        Edit
                      </Link>
                      <RowActionButton
                        action={setEmployeeActive.bind(null, e.id, !e.isActive)}
                        label={e.isActive ? 'Deactivate' : 'Activate'}
                        pendingLabel={e.isActive ? 'Deactivating…' : 'Activating…'}
                        buttonClassName="text-sm text-zinc-700 hover:text-zinc-900 font-medium"
                      />
                      <EmployeePinReset action={resetEmployeePin.bind(null, e.id)} employeeName={e.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-2 text-center text-zinc-500">No employees found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
