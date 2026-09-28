'use client';

import { useState } from 'react';
import { updateAdjustmentAction } from '@/app/actions/payroll';
import { useT } from '@/i18n/client';
import { clearDraft, useDraftState } from '@/i18n/draft-store';

export default function PayrollAdjustmentForm({ lineId, amount, note }: { lineId: string; amount: number; note: string }) {
  const t = useT('adminStaff');
  // Unsaved figures survive a language switch (memory only).
  const amountKey = `payroll-adjustment:${lineId}:amount`;
  const noteKey = `payroll-adjustment:${lineId}:note`;
  const [a, setA] = useDraftState(amountKey, String(amount));
  const [n, setN] = useDraftState(noteKey, note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await updateAdjustmentAction(lineId, Number(a) || 0, n);
      if (result?.error) setError(result.error);
      else {
        setSaved(true);
        clearDraft(amountKey);
        clearDraft(noteKey);
      }
    } catch {
      setError(t('payroll.adjustment.failed'));
    } finally {
      // Always released, so a failed save can be retried instead of leaving the
      // button stuck on 'Saving…'.
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2 items-center">
        <input type="number" step="0.01" value={a} onChange={(e) => setA(e.target.value)} aria-label={t('payroll.adjustment.amount')} className="border p-1 w-24 rounded" />
        <input type="text" value={n} onChange={(e) => setN(e.target.value)} placeholder={t('payroll.adjustment.notePlaceholder')} aria-label={t('payroll.adjustment.note')} className="border p-1 rounded" />
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="text-zinc-900 underline disabled:opacity-50"
        >
          {saving ? t('payroll.adjustment.saving') : t('payroll.adjustment.save')}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 whitespace-normal" role="alert">{error}</p>}
      {saved && !error && <p className="text-xs text-zinc-600" role="status">{t('payroll.adjustment.saved')}</p>}
    </div>
  );
}
