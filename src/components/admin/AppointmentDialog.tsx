'use client';

import { useEffect, useRef, useState } from 'react';
import { createAppointmentByAdmin, editAppointmentByAdmin, searchAdminCustomers, type AdminCustomerMatch } from '@/app/actions/admin-schedule';
import type { MoveClash } from '@/app/services/admin-move-clashes';
import { describeClash } from '@/app/lib/describe-clash';
import { MIN_DURATION_MINUTES } from '@/app/lib/calendar-geometry';

export type DialogService = {
  id: string;
  name: string;
  duration: number;
  price: number;
  category: string;
  requiresPatchTest: boolean;
};

export type DialogStylist = { id: string; name: string };

/** What the board hands the dialog: either a blank slot, or a booking to edit. */
export type DialogTarget =
  | { mode: 'create'; dateStr: string; time: string; stylistId?: string }
  | {
      mode: 'edit';
      appointmentId: string;
      dateStr: string;
      time: string;
      stylistId: string;
      serviceId: string;
      durationMin: number;
      notes: string;
      customerName: string;
      status: string;
      updatedAt: string;
    };

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-zinc-600 mb-1';

/** Round up to the next quarter hour, the grain the whole board snaps to. */
function nextQuarterHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const rounded = Math.ceil((h * 60 + m) / MIN_DURATION_MINUTES) * MIN_DURATION_MINUTES;
  const capped = Math.min(rounded, 23 * 60 + 45);
  return `${String(Math.floor(capped / 60)).padStart(2, '0')}:${String(capped % 60).padStart(2, '0')}`;
}

export function AppointmentDialog({
  target,
  services,
  stylists,
  onClose,
  onSaved,
}: {
  target: DialogTarget;
  services: DialogService[];
  stylists: DialogStylist[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = target.mode === 'edit';
  const [serviceId, setServiceId] = useState(isEdit ? target.serviceId : services[0]?.id ?? '');
  const [stylistId, setStylistId] = useState(target.stylistId ?? stylists[0]?.id ?? '');
  const [dateStr, setDateStr] = useState(target.dateStr);
  const [time, setTime] = useState(isEdit ? target.time : nextQuarterHour(target.time));
  const [durationMin, setDurationMin] = useState(
    isEdit ? target.durationMin : services[0]?.duration ?? 30,
  );
  const [notes, setNotes] = useState(isEdit ? target.notes : '');
  const [status, setStatus] = useState<'CONFIRMED' | 'PENDING'>('CONFIRMED');
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  // Customer picker (create only — an edit keeps whoever the booking belongs to).
  const [customerQuery, setCustomerQuery] = useState('');
  // Results carry the query they answered, so a slow reply for an abandoned
  // query is never rendered under a newer one.
  const [results, setResults] = useState<{ query: string; rows: AdminCustomerMatch[] }>({ query: '', rows: [] });
  const [picked, setPicked] = useState<AdminCustomerMatch | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<MoveClash[] | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const selectedService = services.find((s) => s.id === serviceId) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needle = customerQuery.trim();
  const searchable = !isEdit && !picked && needle.length >= 2;
  const matches = results.query === needle ? results.rows : [];

  // Debounced so a name typed at speed costs one lookup, not one per keystroke —
  // this reads the customer table on every call (see searchAdminCustomers).
  useEffect(() => {
    if (!searchable) return;
    let live = true;
    const id = setTimeout(async () => {
      const rows = await searchAdminCustomers(needle);
      if (live) setResults({ query: needle, rows });
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [needle, searchable]);

  const chooseService = (id: string) => {
    setServiceId(id);
    // Track the menu's duration until the admin overrides it by hand; a
    // 45-minute slot left over from the previous choice is never what they want.
    const next = services.find((s) => s.id === id);
    if (next) setDurationMin(next.duration);
  };

  const submit = async (overrideClashes: boolean) => {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        const result = await editAppointmentByAdmin({
          appointmentId: target.appointmentId,
          dateStr,
          time,
          durationMin,
          stylistId,
          serviceId,
          notes,
          overrideClashes,
          expectedUpdatedAt: target.updatedAt,
        });
        if (result.success) return onSaved();
        if ('clashes' in result) return setClashes(result.clashes);
        return setError(result.error);
      }

      const customer = picked
        ? ({ kind: 'existing', userId: picked.id } as const)
        : ({ kind: 'new', name: name.trim() || customerQuery.trim(), email, phone } as const);
      if (customer.kind === 'new' && !customer.name) {
        return setError('Enter the customer’s name.');
      }

      const result = await createAppointmentByAdmin({
        customer,
        serviceId,
        stylistId,
        dateStr,
        time,
        durationMin,
        status,
        notes,
        notifyCustomer,
        overrideClashes,
      });
      if (result.success) return onSaved();
      if ('clashes' in result) return setClashes(result.clashes);
      return setError(result.error);
    } finally {
      setSaving(false);
    }
  };

  const cancelBooking = async () => {
    if (target.mode !== 'edit' || saving) return;
    if (!window.confirm(`Cancel ${target.customerName}’s booking? This releases the appointment time.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { updateAppointmentStatus } = await import('@/app/actions/admin');
      const result = await updateAppointmentStatus(target.appointmentId, 'CANCELLED');
      if (result.success) return onSaved();
      setError(result.error ?? 'Could not cancel the booking. Please try again.');
    } catch {
      setError('Could not cancel the booking. Refresh to check its status before retrying.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-900/50 p-0 sm:p-4"
      onClick={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit booking' : 'New booking'}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg bg-white shadow-xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4">
          <h2 className="text-lg font-bold text-zinc-900">{isEdit ? 'Edit booking' : 'New booking'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-2xl leading-none text-zinc-500 hover:bg-zinc-100">
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {clashes && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-sm font-semibold text-amber-900">This booking clashes:</p>
              <ul className="mt-1 mb-2 list-inside list-disc text-sm text-amber-800">
                {clashes.map((clash, index) => <li key={index}>{describeClash(clash)}</li>)}
              </ul>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => { setClashes(null); submit(true); }} className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                  Book anyway
                </button>
                <button type="button" onClick={() => setClashes(null)} className="rounded border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
                  Go back
                </button>
              </div>
            </div>
          )}

          {isEdit ? (
            <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <span className="font-medium text-zinc-900">{target.customerName}</span>
              <span className="ml-2 text-zinc-500">· {target.status}</span>
            </div>
          ) : (
            <fieldset>
              <legend className={labelClass}>Customer</legend>
              {picked ? (
                <div className="flex items-center justify-between rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-zinc-900">{picked.name ?? 'Customer'}</span>
                    {picked.phone && <span className="ml-2 text-zinc-500">{picked.phone}</span>}
                  </span>
                  <button type="button" onClick={() => { setPicked(null); setCustomerQuery(''); }} className="text-xs font-medium text-zinc-600 underline">
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={inputClass}
                    placeholder="Search name, phone or email…"
                    value={customerQuery}
                    onChange={(event) => { setCustomerQuery(event.target.value); setName(event.target.value); }}
                  />
                  {matches.length > 0 && (
                    <ul className="mt-1 divide-y divide-zinc-100 rounded border border-zinc-200">
                      {matches.map((match) => (
                        <li key={match.id}>
                          <button type="button" onClick={() => setPicked(match)} className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50">
                            <span className="font-medium text-zinc-900">{match.name ?? 'Customer'}</span>
                            <span className="ml-2 text-zinc-500">{match.phone ?? match.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className={inputClass} placeholder="Phone (optional)" value={phone} onChange={(event) => setPhone(event.target.value)} />
                    <input className={inputClass} type="email" placeholder="Email (optional)" value={email} onChange={(event) => setEmail(event.target.value)} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    No email is fine — a phone or WhatsApp booking is saved without one, and no email is sent.
                  </p>
                </>
              )}
            </fieldset>
          )}

          <div>
            <label className={labelClass} htmlFor="appt-service">Service</label>
            <select id="appt-service" className={inputClass} value={serviceId} onChange={(event) => chooseService(event.target.value)}>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.category} · {service.name} ({service.duration} min, £{service.price.toFixed(2)})
                </option>
              ))}
            </select>
            {selectedService?.requiresPatchTest && (
              <p className="mt-1 text-xs text-amber-700">This colour service needs a valid patch test — you will be warned if there isn’t one.</p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="appt-stylist">Stylist</label>
            <select id="appt-stylist" className={inputClass} value={stylistId} onChange={(event) => setStylistId(event.target.value)}>
              {stylists.map((stylist) => <option key={stylist.id} value={stylist.id}>{stylist.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor="appt-date">Date</label>
              <input id="appt-date" type="date" className={inputClass} value={dateStr} onChange={(event) => setDateStr(event.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="appt-time">Start</label>
              <input id="appt-time" type="time" step={900} className={inputClass} value={time} onChange={(event) => setTime(event.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="appt-duration">Minutes</label>
              <input
                id="appt-duration"
                type="number"
                min={MIN_DURATION_MINUTES}
                step={MIN_DURATION_MINUTES}
                className={inputClass}
                value={durationMin}
                onChange={(event) => setDurationMin(Number(event.target.value))}
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="appt-notes">Notes</label>
            <textarea id="appt-notes" rows={2} className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Booked via WhatsApp, allergy, preferences…" />
          </div>

          {!isEdit && (
            <div className="space-y-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-zinc-800">
                <input type="checkbox" checked={status === 'PENDING'} onChange={(event) => setStatus(event.target.checked ? 'PENDING' : 'CONFIRMED')} />
                Pencil in as a request instead of confirming
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-800">
                <input type="checkbox" checked={notifyCustomer} disabled={status === 'PENDING'} onChange={(event) => setNotifyCustomer(event.target.checked)} />
                Email the customer a confirmation
              </label>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-white px-5 py-3">
          {isEdit && (target.status === 'PENDING' || target.status === 'CONFIRMED') && (
            <button type="button" disabled={saving} onClick={cancelBooking} className="mr-auto rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              Cancel booking
            </button>
          )}
          <button type="button" disabled={saving} onClick={onClose} className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            {isEdit ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={saving || !serviceId || !stylistId}
            onClick={() => submit(false)}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
