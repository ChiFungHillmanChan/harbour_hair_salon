'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { Resend } from 'resend';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const unsubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
});

export type UnsubscribeState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
}

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

let unsubLimiter: Ratelimit | null | undefined;
function getUnsubLimiter(): Ratelimit | null {
  if (unsubLimiter !== undefined) return unsubLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  unsubLimiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(3, '1 h'),
        prefix: 'rl:unsub',
      })
    : null;
  return unsubLimiter;
}

export async function unsubscribeFromMarketing(
  _prev: UnsubscribeState,
  formData: FormData
): Promise<UnsubscribeState> {
  const ip = getClientIp(await headers());
  const limiter = getUnsubLimiter();
  if (limiter) {
    try {
      const { success } = await limiter.limit(ip);
      if (!success) {
        return { status: 'error', message: 'Too many requests. Please try again in an hour.' };
      }
    } catch (err) {
      console.error('Unsubscribe rate limiter unavailable, allowing request:', err);
    }
  }

  const parsed = unsubscribeSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid email address.' };
  }

  const resend = getResendClient();
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!resend || !audienceId) {
    console.error('Marketing unsubscribe is not configured: missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    return { status: 'error', message: 'Unsubscribe is temporarily unavailable. Please contact the salon.' };
  }

  try {
    const update = await resend.contacts.update({
      email: parsed.data.email,
      audienceId,
      unsubscribed: true,
    });
    if (update.error) {
      const message = update.error.message ?? String(update.error);
      // A contact that was never subscribed is already "not receiving marketing" —
      // report success without creating a new contact (which would let anyone flood
      // the audience with arbitrary emails).
      if (/not.?found|does not exist|could not find/i.test(message)) {
        return { status: 'success', message: 'You have been unsubscribed from marketing emails.' };
      }
      throw new Error(message);
    }
  } catch (error) {
    console.error('Marketing unsubscribe failed:', error);
    return { status: 'error', message: 'Unsubscribe failed. Please try again later.' };
  }

  return { status: 'success', message: 'You have been unsubscribed from marketing emails.' };
}
