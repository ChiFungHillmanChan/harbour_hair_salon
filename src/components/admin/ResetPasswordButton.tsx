'use client';

import { resetUserPassword } from '@/app/actions/admin';

interface ResetPasswordButtonProps {
  userId: string;
  userName: string;
}

export function ResetPasswordButton({ userId, userName }: ResetPasswordButtonProps) {
  const handleResetPassword = async () => {
    const newPassword = window.prompt(`Enter new password for ${userName}:`);

    if (!newPassword) {
      return;
    }

    try {
      const result = await resetUserPassword(userId, newPassword);

      if (result.error) {
        alert(`Error: ${result.error}`);
      } else if (result.success) {
        alert(`Password reset successfully for ${userName}`);
      }
    } catch (error) {
      alert(`Error resetting password: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <button
      onClick={handleResetPassword}
      className="text-zinc-700 hover:text-zinc-900 mr-4"
    >
      Reset Password
    </button>
  );
}
