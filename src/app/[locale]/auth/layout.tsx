import type { Metadata } from 'next';
import { ClientMessages } from '@/i18n/ClientMessages';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientMessages namespaces={['auth']}>{children}</ClientMessages>;
}
