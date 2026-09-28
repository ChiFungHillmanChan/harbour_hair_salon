import { verifySession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ClientMessages } from '@/i18n/ClientMessages';
import { localizedPath } from '@/i18n/request';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();

  if (session.role !== 'ADMIN') {
    redirect(await localizedPath('/'));
  }

  return (
    // Admin pages are signed-in only (never public, never cached for
    // visitors), so every admin namespace ships once with the shell.
    <ClientMessages namespaces={['admin', 'adminSchedule', 'adminCatalog', 'adminContent', 'adminOps', 'adminStaff', 'pricing', 'errors']}>
      <div className="min-h-screen bg-zinc-50 lg:flex">
        <AdminSidebar userId={session.userId} logoutAction={logout} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </ClientMessages>
  );
}
