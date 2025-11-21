import { verifySession } from '@/app/lib/session';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';

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
    <div className="min-h-screen bg-zinc-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-900 text-white flex flex-col">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="text-xl font-serif font-bold tracking-wider">ADMIN PANEL</h2>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <Link href="/admin" className="block px-4 py-2 rounded hover:bg-zinc-800 transition-colors">
            Schedule
          </Link>
          <Link href="/admin/discounts" className="block px-4 py-2 rounded hover:bg-zinc-800 transition-colors">
            Discounts
          </Link>
          <Link href="/admin/offers" className="block px-4 py-2 rounded hover:bg-zinc-800 transition-colors">
            Offers
          </Link>
          <Link href="/admin/users" className="block px-4 py-2 rounded hover:bg-zinc-800 transition-colors">
            Admin Users
          </Link>
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <div className="mb-4 px-4">
            <p className="text-xs text-zinc-500 uppercase">Logged in as</p>
            <p className="text-sm font-medium truncate">{session.userId}</p>
          </div>
          <form action={logout}>
            <button className="w-full bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

