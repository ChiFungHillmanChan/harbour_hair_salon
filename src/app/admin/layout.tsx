import { verifySession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();

  if (session.role !== 'ADMIN') {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-zinc-50 lg:flex">
      <AdminSidebar userId={session.userId} logoutAction={logout} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

