'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { getActionT } from '@/i18n/request';
import { HTML_LANG } from '@/i18n/config';
import { formatCalendarDay } from '@/i18n/dates';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { validateWeek, type DayInput, type WeekValidation } from '@/app/services/opening-hours';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    throw new Error('Unauthorized');
  }
}

export type OpeningHoursState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

/** dayOfWeek 0-6 → a date with that weekday (2023-01-01 was a Sunday). */
const WEEKDAY_SAMPLE = ['2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05', '2023-01-06', '2023-01-07'];

/** The validator's refusal, from its code, in the admin's language. */
function weekErrorText(t: Translate<Messages['adminSchedule']>, refusal: Extract<WeekValidation, { ok: false }>): string {
  const dayName = (dayOfWeek: number) => WEEKDAY_SAMPLE[dayOfWeek]
    ? formatCalendarDay(t.locale, WEEKDAY_SAMPLE[dayOfWeek], { weekday: 'long' })
    : String(dayOfWeek);
  const missing = new Intl.ListFormat(HTML_LANG[t.locale], { type: 'conjunction', style: 'narrow' })
    .format((refusal.missing ?? []).map(dayName));
  return t.dynamic(`openingHours.errors.${refusal.code}`, {
    day: refusal.dayOfWeek === undefined ? undefined : dayName(refusal.dayOfWeek),
    missing,
  }, t('openingHours.errors.INVALID'));
}

/**
 * Replaces one stylist's whole week in a single transaction.
 *
 * Whole-week rather than per-day because the form submits the week as a unit:
 * a partial write would leave the site selling a mix of old and new hours, and
 * there is no UI that can express "Tuesday saved, Wednesday didn't".
 */
export async function updateStylistAvailability(
  _prev: OpeningHoursState,
  formData: FormData
): Promise<OpeningHoursState> {
  await requireAdmin();
  // Messages are returned in the admin's interface language.
  const t = await getActionT('adminSchedule');

  const stylistId = formData.get('stylistId');
  if (typeof stylistId !== 'string' || !stylistId) {
    return { status: 'error', message: t('openingHours.errors.MISSING_STYLIST') };
  }

  const days: DayInput[] = [];
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    days.push({
      dayOfWeek,
      // An unchecked checkbox is absent from FormData entirely, so "open" is
      // read as an explicit presence test rather than a value comparison.
      isOff: formData.get(`open-${dayOfWeek}`) !== 'on',
      startTime: String(formData.get(`start-${dayOfWeek}`) ?? ''),
      endTime: String(formData.get(`end-${dayOfWeek}`) ?? ''),
    });
  }

  const validated = validateWeek(days);
  if (!validated.ok) {
    return { status: 'error', message: weekErrorText(t, validated) };
  }

  try {
    await saveWeek(stylistId, validated.days);
  } catch (error) {
    // Answer in the form instead of throwing to the error boundary, which
    // would replace the form and lose the week being edited. Name and code
    // only: a driver message can carry the database host.
    const code = (error as { code?: unknown } | null)?.code;
    console.error('Saving opening hours failed:', { stylistId, error: error instanceof Error ? error.name : 'unknown', ...(typeof code === 'string' ? { code } : {}) });
    return { status: 'error', message: t('openingHours.errors.SAVE_FAILED') };
  }

  // /book reads availability per request, but the admin screen and the booking
  // page both need to reflect the new week immediately.
  updateTag('calendar-sync-hours');
  updateTag('site-settings');
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/admin/opening-hours');
  revalidateAllLocales(revalidatePath, '/book');

  return { status: 'success' };
}

function saveWeek(stylistId: string, days: Extract<WeekValidation, { ok: true }>['days']) {
  return prisma.$transaction(
    days.map((day) =>
      prisma.availability.upsert({
        where: { stylistId_dayOfWeek: { stylistId, dayOfWeek: day.dayOfWeek } },
        update: { isOff: day.isOff, startTime: day.startTime, endTime: day.endTime },
        // validateWeek() has already normalised closed days to a storable
        // window, so create and update take the same values.
        create: {
          stylistId,
          dayOfWeek: day.dayOfWeek,
          isOff: day.isOff,
          startTime: day.startTime,
          endTime: day.endTime,
        },
      })
    )
  );
}
