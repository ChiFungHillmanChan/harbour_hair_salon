import prisma from '@/app/lib/prisma';
import EmployeeForm from '@/components/admin/EmployeeForm';
import { createEmployee } from '@/app/actions/employees';
import KioskModeButton from '@/components/admin/KioskModeButton';

export default async function AdminEmployeesPage() {
  const [employees, stylists] = await Promise.all([
    prisma.employee.findMany({ orderBy: { name: 'asc' }, include: { stylist: true } }),
    prisma.stylist.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="p-6 space-y-8">
      <h1 className="font-serif text-3xl text-zinc-900">Employees</h1>
      <KioskModeButton />

      <section>
        <h2 className="text-xl mb-3">Add employee</h2>
        <EmployeeForm action={createEmployee} stylists={stylists} />
      </section>

      <section>
        <h2 className="text-xl mb-3">Team</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Name</th><th className="p-2">Title</th><th className="p-2">Pay type</th>
              <th className="p-2">Stylist link</th><th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-b">
                <td className="p-2">{e.name}</td>
                <td className="p-2">{e.title}</td>
                <td className="p-2">{e.payType}</td>
                <td className="p-2">{e.stylist?.name ?? '—'}</td>
                <td className="p-2">{e.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={5} className="p-2 text-center text-zinc-500">No employees found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
