'use client';

import { useState } from 'react';
import { clockToggle } from '@/app/actions/kiosk';

type RosterEntry = { id: string; name: string; title: string; imageUrl: string | null; isClockedIn: boolean };

export default function KioskClock({ roster }: { roster: RosterEntry[] }) {
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setSelected(null);
    setPin('');
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    const res = await clockToggle(selected.id, pin);
    setBusy(false);
    if (res.ok) {
      setMessage(`${res.name}: clocked ${res.status === 'IN' ? 'in' : 'out'} ✓`);
      reset();
      setTimeout(() => setMessage(null), 3000);
    } else {
      setMessage(res.error ?? 'Error');
      setPin('');
    }
  }

  if (selected) {
    return (
      <div className="max-w-xs mx-auto text-center">
        <p className="text-xl mb-2">{selected.name}</p>
        <p className="mb-4 opacity-80">{selected.isClockedIn ? 'Clock out' : 'Clock in'}</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Enter PIN"
          className="w-full text-center text-2xl tracking-[0.5em] p-4 rounded text-black"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={reset} className="flex-1 border border-white/40 py-3 rounded">Back</button>
          <button onClick={submit} disabled={busy || pin.length < 4} className="flex-1 bg-accent text-black py-3 rounded font-bold disabled:opacity-50">
            Confirm
          </button>
        </div>
        {message && <p className="mt-4">{message}</p>}
      </div>
    );
  }

  return (
    <div>
      {message && <p className="text-center text-accent text-xl mb-6">{message}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {roster.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r)}
            className="bg-white/10 hover:bg-white/20 transition-colors rounded-lg p-6 text-center"
          >
            <span className="block text-lg font-bold">{r.name}</span>
            <span className="block text-sm opacity-70">{r.title}</span>
            <span className={`block text-xs mt-2 ${r.isClockedIn ? 'text-green-300' : 'text-white/50'}`}>
              {r.isClockedIn ? '● On shift' : '○ Off'}
            </span>
          </button>
        ))}
        {roster.length === 0 && <p className="col-span-full text-center opacity-70">Kiosk not enabled or no active staff.</p>}
      </div>
    </div>
  );
}
