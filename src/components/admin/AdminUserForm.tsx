'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createAdminUser, type AdminUserActionState } from '@/app/actions/admin';

export function AdminUserForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<AdminUserActionState, FormData>(
    createAdminUser,
    {}
  );

  // Only clear the fields once the admin actually exists — a rejected email or
  // too-short password keeps what was typed so it can be corrected.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <div className="bg-white p-6 rounded-lg shadow border border-zinc-200 mb-8">
      <h3 className="text-lg font-bold mb-4">Create New Admin User</h3>
      <form ref={formRef} action={formAction} className="space-y-4">
        {state.error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm"
            role="alert"
          >
            {state.error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Name</label>
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. John Admin"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
            <input
              type="email"
              name="email"
              required
              placeholder="e.g. admin@harbourhair.com"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Password</label>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
        </div>
        <div className="flex justify-end items-center gap-3">
          {state.success && <span className="text-xs text-emerald-600">✓ Created</span>}
          <button
            type="submit"
            disabled={pending}
            className="bg-zinc-900 text-white px-6 py-2 rounded-md hover:bg-zinc-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create Admin'}
          </button>
        </div>
      </form>
    </div>
  );
}

