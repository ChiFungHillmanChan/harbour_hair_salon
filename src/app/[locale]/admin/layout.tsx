import { verifySession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
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
        <AdminSidebar userId={session.userId} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </ClientMessages>
  );
}
