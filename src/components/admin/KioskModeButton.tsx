'use client';

import { useState } from 'react';
import { enableKioskMode, disableKioskMode } from '@/app/actions/kiosk';
import { useT } from '@/i18n/client';
import { useDraftState } from '@/i18n/draft-store';

export default function KioskModeButton() {
  const t = useT('adminStaff');
  const [msg, setMsg] = useState<{ error: string } | 'disabled' | null>(null);
  // null = the default name, so the default follows the interface language.
  const [typedName, setTypedName] = useDraftState<string | null>('kiosk-device-name', null);
  const deviceName = typedName ?? t('kioskDevices.defaultName');
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <form action={async () => {
        const result = await enableKioskMode(deviceName);
        if (result?.error) setMsg({ error: result.error });
      }} className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="min-w-0 text-sm text-zinc-700">
          {t('kioskDevices.deviceName')}
          <input value={deviceName} onChange={(event) => setTypedName(event.target.value)} maxLength={80} required className="mt-1 block min-h-11 w-full min-w-0 rounded border border-zinc-300 px-3 py-2 text-base sm:text-sm" />
        </label>
        <button type="submit" className="min-h-11 bg-zinc-900 text-white px-4 py-2 rounded">
          {t('kioskDevices.open')}
        </button>
      </form>
      <button
        onClick={async () => { await disableKioskMode(); setMsg('disabled'); }}
        className="min-h-11 border px-4 py-2 rounded"
      >
        {t('kioskDevices.disableThis')}
      </button>
      {msg && <span className="text-sm text-zinc-600" role="status">{msg === 'disabled' ? t('kioskDevices.disabledThis') : msg.error}</span>}
    </div>
  );
}
