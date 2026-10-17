'use client';

import { resetUserPassword } from '@/app/actions/admin';
import { useT } from '@/i18n/client';

interface ResetPasswordButtonProps {
  userId: string;
  userName: string;
}

export function ResetPasswordButton({ userId, userName }: ResetPasswordButtonProps) {
  const t = useT('adminOps');
  const handleResetPassword = async () => {
    const newPassword = window.prompt(t('users.resetPassword.prompt', { name: userName }));

    if (!newPassword) {
      return;
    }

    try {
      const result = await resetUserPassword(userId, newPassword);

      if (result.error) {
        alert(t('users.resetPassword.error', { error: result.error }));
      } else if (result.success) {
        alert(t('users.resetPassword.success', { name: userName }));
      }
    } catch (error) {
      alert(t('users.resetPassword.failed', { error: error instanceof Error ? error.message : t('users.resetPassword.unknownError') }));
    }
  };

  return (
    <button
      onClick={handleResetPassword}
      className="min-h-11 rounded border border-zinc-200 px-3 py-2 text-zinc-700 hover:text-zinc-900"
    >
      {t('users.resetPassword.button')}
    </button>
  );
}
