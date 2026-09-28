import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { getT } from '@/i18n/server';
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
  const t = await getT('adminStaff');
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
      <h1 className="font-serif text-2xl sm:text-3xl text-zinc-900">{t('employees.title')}</h1>
      <KioskModeButton />
      <KioskSessions sessions={kiosks} />

      <section>
        <h2 className="text-xl mb-3">{t('employees.addTitle')}</h2>
        <EmployeeForm action={createEmployee} stylists={stylists} linkedStylistIds={linkedStylistIds} />
      </section>

      <section>
        <h2 className="text-xl mb-3">{t('employees.teamTitle')}</h2>
        <p className="text-sm text-zinc-600 mb-3">{t('employees.teamIntro')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">{t('employees.columns.name')}</th><th className="p-2">{t('employees.columns.title')}</th><th className="p-2">{t('employees.columns.payType')}</th>
                <th className="p-2">{t('employees.columns.stylist')}</th><th className="p-2">{t('employees.columns.status')}</th><th className="p-2">{t('employees.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b align-top">
                  <td className="p-2">{e.name}</td>
                  <td className="p-2">{e.title}</td>
                  <td className="p-2">{t.dynamic(`payType.${e.payType}`, undefined, e.payType)}</td>
                  <td className="p-2">{e.stylist?.name ?? '—'}</td>
                  <td className="p-2">
                    {e.isActive ? (
                      t('employees.active')
                    ) : (
                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-200 text-zinc-700 rounded-full">
                        {t('employees.inactive')}
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Link
                        href={`/admin/employees/${e.id}/edit`}
                        className="text-sm text-zinc-700 hover:text-zinc-900 font-medium underline"
                      >
                        {t('employees.edit')}
                      </Link>
                      <RowActionButton
                        action={setEmployeeActive.bind(null, e.id, !e.isActive)}
                        label={e.isActive ? t('employees.deactivate') : t('employees.activate')}
                        pendingLabel={e.isActive ? t('employees.deactivating') : t('employees.activating')}
                        buttonClassName="text-sm text-zinc-700 hover:text-zinc-900 font-medium"
                      />
                      <EmployeePinReset action={resetEmployeePin.bind(null, e.id)} employeeName={e.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-2 text-center text-zinc-500">{t('employees.empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
