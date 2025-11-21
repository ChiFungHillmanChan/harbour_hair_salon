'use client';

import { createDiscountCode } from '@/app/actions/admin';
import { useRef } from 'react';

export function DiscountForm() {
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (formData: FormData) => {
    await createDiscountCode(formData);
    formRef.current?.reset();
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow border border-zinc-200 mb-8">
      <h3 className="text-lg font-bold mb-4">Create New Discount Code</h3>
      <form ref={formRef} action={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Code</label>
            <input 
              type="text" 
              name="code" 
              required 
              placeholder="e.g. SUMMER20"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Type</label>
            <select 
              name="type" 
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            >
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FIXED">Fixed Amount (£)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Value</label>
            <input 
              type="number" 
              step="0.01" 
              name="value" 
              required 
              placeholder="e.g. 20 or 10.00"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Max Uses (Optional)</label>
            <input 
              type="number" 
              name="maxUses" 
              placeholder="Unlimited"
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Expires At (Optional)</label>
            <input 
              type="datetime-local" 
              name="expiresAt" 
              className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button 
            type="submit" 
            className="bg-zinc-900 text-white px-6 py-2 rounded-md hover:bg-zinc-800 transition-colors text-sm font-medium"
          >
            Create Code
          </button>
        </div>
      </form>
    </div>
  );
}

