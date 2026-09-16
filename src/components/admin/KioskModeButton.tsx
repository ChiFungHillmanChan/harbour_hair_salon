'use client';

import { useState } from 'react';
import { enableKioskMode, disableKioskMode } from '@/app/actions/kiosk';

export default function KioskModeButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('Salon kiosk');
  return (
    <div className="flex flex-wrap items-end gap-3">
      <form action={async () => {
        const result = await enableKioskMode(deviceName);
        if (result?.error) setMsg(result.error);
      }} className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-zinc-700">
          Device name
          <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} required className="mt-1 block rounded border border-zinc-300 px-3 py-2" />
        </label>
        <button type="submit" className="bg-zinc-900 text-white px-4 py-2 rounded">
          Sign out and open kiosk
        </button>
      </form>
      <button
        onClick={async () => { await disableKioskMode(); setMsg('Kiosk disabled on this device'); }}
        className="border px-4 py-2 rounded"
      >
        Disable this device
      </button>
      {msg && <span className="text-sm text-zinc-600">{msg}</span>}
    </div>
  );
}
