import prisma from '@/app/lib/prisma';
import { AdminUserForm } from '@/components/admin/AdminUserForm';
import { deleteAdminUser, promoteGoogleUserToAdmin } from '@/app/actions/admin';
import { verifySession } from '@/app/lib/session';
import { ResetPasswordButton } from '@/components/admin/ResetPasswordButton';

export default async function AdminUsersPage() {
  const session = await verifySession();
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      oauthAccounts: { where: { provider: 'google' }, select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const googleCustomers = await prisma.user.findMany({
    where: {
      role: 'USER',
      oauthAccounts: { some: { provider: 'google' } },
    },
    select: { id: true, name: true, email: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">Admin Users</h1>
        <p className="text-zinc-600 mt-2">Manage administrators who can access this panel.</p>
      </div>

      <AdminUserForm />

      <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Created At</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
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
                  {new Date(admin.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {admin.id !== session.userId && (
                    <div className="flex justify-end gap-2">
                      <ResetPasswordButton userId={admin.id} userName={admin.name || 'User'} />
                      <form action={deleteAdminUser.bind(null, admin.id)}>
                        <button className="text-red-600 hover:text-red-900">Delete</button>
                      </form>
                    </div>
                  )}
                  {admin.id === session.userId && (
                    <span className="text-zinc-400 italic">Current User</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 rounded-lg border border-zinc-200 bg-white shadow">
        <div className="border-b border-zinc-200 p-6">
          <h2 className="text-lg font-bold text-zinc-900">Google users</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Promote a customer who has signed in with Google. They will sign in again to receive admin access.
          </p>
        </div>
        {googleCustomers.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No Google users are waiting to be promoted.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Email</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {googleCustomers.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 text-sm font-medium text-zinc-900">{user.name || 'Google user'}</td>
                    <td className="px-6 py-4 text-sm text-zinc-500">{user.email}</td>
                    <td className="px-6 py-4 text-right">
                      <form action={promoteGoogleUserToAdmin.bind(null, user.id)}>
                        <button className="rounded-md bg-[#174F7F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#123f66]">
                          Make admin
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
    </div>
  );
}
