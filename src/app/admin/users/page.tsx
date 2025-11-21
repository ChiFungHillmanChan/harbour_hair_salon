import prisma from '@/app/lib/prisma';
import { AdminUserForm } from '@/components/admin/AdminUserForm';
import { deleteAdminUser } from '@/app/actions/admin';
import { verifySession } from '@/app/lib/session';

export default async function AdminUsersPage() {
  const session = await verifySession();
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Admin Users</h1>
        <p className="text-zinc-600 mt-2">Manage administrators who can access this panel.</p>
      </div>

      <AdminUserForm />

      <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden">
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
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">{admin.email}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                  {new Date(admin.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {admin.id !== session.userId && (
                    <form action={deleteAdminUser.bind(null, admin.id)}>
                      <button className="text-red-600 hover:text-red-900">Delete</button>
                    </form>
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
    </div>
  );
}

