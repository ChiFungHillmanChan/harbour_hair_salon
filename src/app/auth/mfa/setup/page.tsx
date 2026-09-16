import { redirect } from 'next/navigation';
import { requirePendingAdminMfa } from '@/app/lib/admin-mfa';
import { getSession, requireAdmin } from '@/app/lib/session';
import { AdminMfaSetupForm } from '@/components/auth/AdminMfaForms';

export const metadata = { title: 'Set up administrator verification', robots: { index: false, follow: false } };

export default async function AdminMfaSetupPage() {
  let enrolled = false;
  let requiresPassword = false;
  if (await getSession()) {
    // Finishing enrollment replaces the challenge cookie with a full session.
    // Next rerenders this page immediately; keep the same client form mounted
    // so its one-time recovery-code action result remains visible.
    await requireAdmin();
    enrolled = true;
  } else {
    const user = await requirePendingAdminMfa();
    if (user.mfaEnabledAt) redirect('/auth/mfa');
    requiresPassword = Boolean(user.password);
  }
  return <main className="flex min-h-[100svh] items-center justify-center bg-zinc-50 px-4 py-12"><div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-xl"><h1 className="font-serif text-3xl text-zinc-900">Protect your admin account</h1><AdminMfaSetupForm requiresPassword={requiresPassword} enrolled={enrolled} /></div></main>;
}
