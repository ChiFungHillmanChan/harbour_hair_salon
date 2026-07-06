'use client';

import { useState } from 'react';
import { updateAdjustmentAction } from '@/app/actions/payroll';

export default function PayrollAdjustmentForm({ lineId, amount, note }: { lineId: string; amount: number; note: string }) {
  const [a, setA] = useState(String(amount));
  const [n, setN] = useState(note);
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <input type="number" step="0.01" value={a} onChange={(e) => setA(e.target.value)} aria-label="Adjustment amount" className="border p-1 w-24 rounded" />
      <input type="text" value={n} onChange={(e) => setN(e.target.value)} placeholder="note" aria-label="Adjustment note" className="border p-1 rounded" />
      <button
        disabled={saving}
        onClick={async () => { setSaving(true); await updateAdjustmentAction(lineId, Number(a) || 0, n); setSaving(false); }}
        className="text-zinc-900 underline disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
