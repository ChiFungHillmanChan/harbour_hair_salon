'use client';

import { useState } from 'react';
import { clockToggle, type ClockErrorCode } from '@/app/actions/kiosk';
import { useT } from '@/i18n/client';
import { useLocalizedRouter } from '@/i18n/navigation';
import { useDraftState } from '@/i18n/draft-store';

type RosterEntry = { id: string; name: string; title: string; imageUrl: string | null; isClockedIn: boolean };

/** Kept as data, not text, so a result on screen follows a language switch. */
type Message =
  | { kind: 'clocked'; name: string; status: 'IN' | 'OUT' }
  | { kind: 'error'; code?: ClockErrorCode; text?: string }
  | { kind: 'connection' };

export default function KioskClock({ roster }: { roster: RosterEntry[] }) {
  const t = useT('kiosk');
  const router = useLocalizedRouter();
  // The open PIN pad and the digits typed so far survive a language switch
  // (memory only, see draft-store). Every submit clears the digits.
  const [selectedId, setSelectedId] = useDraftState<string | null>('kiosk:selected', null);
  const [pin, setPin] = useDraftState('kiosk:pin', '');
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = roster.find((entry) => entry.id === selectedId) ?? null;

  function reset() {
    setSelectedId(null);
    setPin('');
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    const typed = pin;
    setPin('');
    try {
      const res = await clockToggle(selected.id, typed);
      if (res.ok) {
        setMessage({ kind: 'clocked', name: res.name, status: res.status });
        reset();
        router.refresh();
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ kind: 'error', code: res.code, text: res.error });
      }
    } catch {
      setMessage({ kind: 'connection' });
    } finally {
      setBusy(false);
    }
  }

  const messageText = !message
    ? null
    : message.kind === 'clocked'
      ? t(message.status === 'IN' ? 'result.clockedIn' : 'result.clockedOut', { name: message.name })
      : message.kind === 'connection'
        ? t('result.connection')
        : message.code
          ? t(`errors.${message.code}`)
          : message.text ?? t('errors.RETRY');

  if (selected) {
    return (
      <div className="max-w-xs mx-auto text-center">
        <p className="text-xl mb-2">{selected.name}</p>
        <p className="mb-4 opacity-80">{selected.isClockedIn ? t('pin.clockOut') : t('pin.clockIn')}</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4 && !busy) submit(); }}
          aria-label={t('pin.label', { name: selected.name })}
          placeholder={t('pin.placeholder')}
          className="w-full text-center text-2xl tracking-[0.5em] p-4 rounded text-black"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={reset} className="flex-1 border border-white/40 py-3 rounded">{t('pin.back')}</button>
          <button onClick={submit} disabled={busy || pin.length < 4} className="flex-1 bg-white text-zinc-900 py-3 rounded font-bold disabled:opacity-50">
            {t('pin.confirm')}
          </button>
        </div>
        {messageText && <p className="mt-4" role="status">{messageText}</p>}
      </div>
    );
  }

  return (
    <div>
      {messageText && <p className="text-center text-zinc-300 text-xl mb-6" role="status">{messageText}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {roster.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedId(r.id)}
            className="bg-white/10 hover:bg-white/20 transition-colors rounded-lg p-6 text-center"
          >
            <span className="block text-lg font-bold">{r.name}</span>
            <span className="block text-sm opacity-70">{r.title}</span>
            <span className={`block text-xs mt-2 ${r.isClockedIn ? 'text-green-300' : 'text-white/50'}`}>
              {r.isClockedIn ? t('roster.onShift') : t('roster.off')}
            </span>
          </button>
        ))}
        {roster.length === 0 && <p className="col-span-full text-center opacity-70">{t('roster.empty')}</p>}
      </div>
    </div>
  );
}
