import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import EmployeeForm from '@/components/admin/EmployeeForm';
import { updateEmployee } from '@/app/actions/employees';

export const dynamic = 'force-dynamic';

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [employee, stylists, linked] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    prisma.stylist.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.employee.findMany({ where: { stylistId: { not: null } }, select: { stylistId: true } }),
  ]);

  if (!employee) notFound();

  // Decimal columns cannot cross the server/client boundary; the form takes strings.
  const employeeForForm = {
    id: employee.id,
    name: employee.name,
    title: employee.title,
    payType: employee.payType,
    hourlyRate: employee.hourlyRate?.toString() ?? null,
    monthlySalary: employee.monthlySalary?.toString() ?? null,
    commissionRate: employee.commissionRate?.toString() ?? null,
    overtimeEnabled: employee.overtimeEnabled,
    overtimeThresholdHours: employee.overtimeThresholdHours?.toString() ?? null,
    overtimeMultiplier: employee.overtimeMultiplier?.toString() ?? null,
    unpaidBreakMinutes: employee.unpaidBreakMinutes?.toString() ?? null,
    stylistId: employee.stylistId,
  };

  const linkedStylistIds = linked
    .map((e) => e.stylistId)
    .filter((stylistId): stylistId is string => Boolean(stylistId));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/admin/employees" className="text-sm text-zinc-600 hover:text-zinc-900 underline">
          ← Back to employees
        </Link>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900 mt-2">Edit employee</h1>
        <p className="text-zinc-700 mt-2">{employee.name} — {employee.title}</p>
      </div>

      <EmployeeForm
        employee={employeeForForm}
        action={updateEmployee.bind(null, employee.id)}
        stylists={stylists}
        linkedStylistIds={linkedStylistIds}
      />

      <p className="text-sm text-zinc-600">
        To change this employee&apos;s clock-in PIN, use the &ldquo;Set PIN&rdquo; box on the{' '}
        <Link href="/admin/employees" className="underline">employees list</Link>.
      </p>
    </div>
  );
}
