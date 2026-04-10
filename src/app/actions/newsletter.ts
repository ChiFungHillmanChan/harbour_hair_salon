'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { Resend } from 'resend';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { sendNewsletterWelcome } from '@/app/services/email-service';

const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
  source: z.string().optional(),
});

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const newsletterLimiter = upstashUrl && upstashToken
  ? new Ratelimit({
      redis: new Redis({ url: upstashUrl, token: upstashToken }),
      limiter: Ratelimit.slidingWindow(3, '1 h'),
      prefix: 'rl:newsletter',
    })
  : null;

async function checkRate(ip: string): Promise<boolean> {
  if (!newsletterLimiter) return true;
  const { success } = await newsletterLimiter.limit(ip);
  return success;
}

type SubscribeState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function subscribeToNewsletter(
  _prev: SubscribeState,
  formData: FormData
): Promise<SubscribeState> {
  const headersList = await headers();
  const ip = getClientIp(headersList);

  if (!(await checkRate(ip))) {
    return {
      status: 'error',
      message: 'Too many requests. Please try again in an hour.',
    };
  }

  const parsed = subscribeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Please enter a valid email address.',
    };
  }

  const { email } = parsed.data;
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured');
    return { status: 'error', message: 'Something went wrong. Please try again later.' };
  }

  // If an audience is configured, add contact to the Resend audience list.
  // If not, we still send the welcome email so the UX isn't blocked on admin setup.
  if (audienceId) {
    try {
      const resend = new Resend(apiKey);
      await resend.contacts.create({
        email,
        audienceId,
        unsubscribed: false,
      });
    } catch (error) {
      // Resend returns an error for duplicates. Treat as idempotent success.
      const message = error instanceof Error ? error.message : String(error);
      if (!/already|exist/i.test(message)) {
        console.error('Newsletter subscribe failed:', error);
        return { status: 'error', message: 'Something went wrong. Please try again later.' };
      }
    }
  } else {
    console.warn(
      'RESEND_AUDIENCE_ID is not set — newsletter contact was not stored in an audience list.'
    );
  }

  await sendNewsletterWelcome(email);

  return { status: 'success' };
}
