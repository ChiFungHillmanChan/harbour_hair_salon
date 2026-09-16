import { redirect } from 'next/navigation';
import { requirePendingAdminMfa } from '@/app/lib/admin-mfa';
import { AdminMfaVerifyForm } from '@/components/auth/AdminMfaForms';

export const metadata = { title: 'Verify administrator sign-in', robots: { index: false, follow: false } };

export default async function AdminMfaPage() {
  const user = await requirePendingAdminMfa();
  if (!user.mfaEnabledAt) redirect('/auth/mfa/setup');
  return <main className="flex min-h-[100svh] items-center justify-center bg-zinc-50 px-4 py-12"><div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-xl"><h1 className="font-serif text-3xl text-zinc-900">Verify your sign-in</h1><p className="text-sm text-zinc-600">Enter your authenticator code to open the admin panel.</p><AdminMfaVerifyForm /></div></main>;
}
