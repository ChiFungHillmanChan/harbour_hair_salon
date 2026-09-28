import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';
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
  await requireAdmin();
  const [{ id }, t] = await Promise.all([params, getT('adminStaff')]);

  const [employee, stylists, linked] = await Promise.all([
    prisma.employee.findUnique({ where: { id }, select: {
      id: true, name: true, title: true, payType: true, hourlyRate: true, monthlySalary: true,
      commissionRate: true, overtimeEnabled: true, overtimeThresholdHours: true,
      overtimeMultiplier: true, unpaidBreakMinutes: true, stylistId: true,
    } }),
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
          ← {t('employees.editPage.back')}
        </Link>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900 mt-2">{t('employees.editPage.title')}</h1>
        <p className="text-zinc-700 mt-2">{employee.name} — {employee.title}</p>
      </div>

      <EmployeeForm
        employee={employeeForForm}
        action={updateEmployee.bind(null, employee.id)}
        stylists={stylists}
        linkedStylistIds={linkedStylistIds}
      />

      <p className="text-sm text-zinc-600">
        {rich(t('employees.editPage.pinHint'), {
          link: (text) => <Link href="/admin/employees" className="underline">{text}</Link>,
        })}
      </p>
    </div>
  );
}
