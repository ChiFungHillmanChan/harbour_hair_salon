'use client';

import { track } from '@vercel/analytics';
import type { ComponentProps } from 'react';

/** Counts a booking-channel click, never a completed appointment or a phone call. */
export function BookingIntentLink({ channel, source, ...props }: Omit<ComponentProps<'a'>, 'onClick'> & {
  channel: string;
  source: string;
}) {
  return (
    <a
      {...props}
      onClick={() => track('booking_intent', { source, channel })}
    />
  );
}
