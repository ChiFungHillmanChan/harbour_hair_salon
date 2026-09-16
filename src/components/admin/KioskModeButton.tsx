'use client';

import { useState } from 'react';
import { enableKioskMode, disableKioskMode } from '@/app/actions/kiosk';

export default function KioskModeButton() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <form action={async () => {
        const result = await enableKioskMode();
        if (result?.error) setMsg(result.error);
      }}>
        <button type="submit" className="bg-zinc-900 text-white px-4 py-2 rounded">
          Sign out and open kiosk
        </button>
      </form>
      <button
        onClick={async () => { await disableKioskMode(); setMsg('Kiosk disabled on this device'); }}
        className="border px-4 py-2 rounded"
      >
        Disable
      </button>
      {msg && <span className="text-sm text-zinc-600">{msg}</span>}
    </div>
  );
}
