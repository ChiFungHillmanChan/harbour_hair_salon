import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { AdminUserForm } from '@/components/admin/AdminUserForm';
import { deleteAdminUser, promoteGoogleUserToAdmin } from '@/app/actions/admin';
import { pageNumber, searchText } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';
import { ResetPasswordButton } from '@/components/admin/ResetPasswordButton';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { formatSalonMediumDate } from '@/i18n/dates';
import { localizeHref } from '@/i18n/paths';
import { getLocale, getT } from '@/i18n/server';

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; admins?: string }> }) {
  const session = await requireAdmin();
  const [query, locale, t] = await Promise.all([searchParams, getLocale(), getT('adminOps')]);
  const page = pageNumber(query.page);
  const adminPage = pageNumber(query.admins);
  const q = searchText(query.q);
  const [adminRows, customerRows] = await Promise.all([prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      oauthAccounts: { where: { provider: 'google' }, select: { id: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26, skip: (adminPage - 1) * 25,
  }), prisma.user.findMany({
    where: {
      role: 'USER',
      ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
      oauthAccounts: { some: { provider: 'google' } },
    },
    select: { id: true, name: true, email: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26, skip: (page - 1) * 25,
  })]);
  const admins = adminRows.slice(0, 25);
  const googleCustomers = customerRows.slice(0, 25);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('users.title')}</h1>
        <p className="text-zinc-600 mt-2">{t('users.intro')}</p>
      </div>

      <AdminUserForm />

      <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('users.columns.name')}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('users.columns.email')}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('users.columns.createdAt')}</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('users.columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            {admins.map((admin) => (
              <tr key={admin.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900">{admin.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {admin.email}
                  {admin.oauthAccounts.length > 0 && (
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Google</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {formatSalonMediumDate(locale, admin.createdAt)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {admin.id !== session.userId && (
                    <div className="flex justify-end gap-2">
                      <ResetPasswordButton userId={admin.id} userName={admin.name || t('users.fallbackName')} />
                      <RowActionButton
                        action={deleteAdminUser.bind(null, admin.id)}
                        label={t('users.delete')}
                        pendingLabel={t('users.deleting')}
                        buttonClassName="text-red-600 hover:text-red-900"
                        confirmMessage={t('users.deleteConfirm', { name: admin.name || admin.email })}
                      />
                    </div>
                  )}
                  {admin.id === session.userId && (
                    <span className="text-zinc-400 italic">{t('users.currentUser')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination path="/admin/users" page={adminPage} pageKey="admins" hasMore={adminRows.length > 25} query={{ q, page: String(page) }} />
      <div className="mt-8 rounded-lg border border-zinc-200 bg-white shadow">
        <div className="border-b border-zinc-200 p-6">
          <h2 className="text-lg font-bold text-zinc-900">{t('users.google.title')}</h2>
          <p className="mt-1 text-sm text-zinc-600">{t('users.google.intro')}</p>
        </div>
        <form action={localizeHref(locale, '/admin/users')} className="flex gap-3 p-6">
          <input name="q" defaultValue={q} maxLength={100} aria-label={t('users.google.searchLabel')} placeholder={t('users.google.searchPlaceholder')} className="rounded border px-3 py-2" />
          <button type="submit" className="underline">{t('users.google.search')}</button>
        </form>
        {googleCustomers.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">{t('users.google.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">{t('users.columns.name')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">{t('users.columns.email')}</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">{t('users.columns.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {googleCustomers.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 text-sm font-medium text-zinc-900">{user.name || t('users.google.fallbackName')}</td>
                    <td className="px-6 py-4 text-sm text-zinc-500">{user.email}</td>
                    <td className="px-6 py-4 text-right">
                      <form action={promoteGoogleUserToAdmin.bind(null, user.id)}>
                        <button className="rounded-md bg-[#174F7F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#123f66]">
                          {t('users.google.makeAdmin')}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Pagination path="/admin/users" page={page} hasMore={customerRows.length > 25} query={{ q, admins: String(adminPage) }} />
    </div>
  );
}
