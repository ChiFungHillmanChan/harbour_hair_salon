'use server';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { Resend } from 'resend';
import { createRateLimiter } from '@/app/lib/rate-limit';
import { verifyUnsubscribeToken } from '@/app/lib/unsubscribe-token';
import { sendMarketingUnsubscribeConfirmation } from '@/app/services/email-service';
import { getActionT } from '@/i18n/request';

// Messages are codes, translated into `legal.unsubscribe.results.*` in the visitor's language.
const unsubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('INVALID_EMAIL'),
});

export type UnsubscribeState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

export type ConfirmUnsubscribeState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  /** `linkInvalid`: the page offers the email form so a fresh link can be sent. */
  | { status: 'error'; message: string; linkInvalid?: boolean };

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
}

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

/** Rate-limit key for an address — never the address itself. */
function emailKey(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

function isNotFound(error: { message?: string; statusCode?: number | null }): boolean {
  return error.statusCode === 404 || /not.?found|does not exist|could not find/i.test(error.message ?? '');
}

const unsubLimiter = createRateLimiter({ prefix: 'rl:unsub', limit: 3, windowSeconds: 60 * 60 });
// However many IPs ask, one address receives at most this many confirmation emails.
const unsubEmailLimiter = createRateLimiter({ prefix: 'rl:unsub-email', limit: 2, windowSeconds: 60 * 60 });

/**
 * Step 1 — email the address a link that proves it is theirs.
 *
 * This no longer touches the mailing list: it used to unsubscribe whatever
 * address was typed in, so anyone who knew an email could switch someone
 * else's marketing off. The answer is the same whether or not the address is
 * on the list — same words, same speed — so the form cannot be used to find
 * out who is subscribed.
 */
export async function unsubscribeFromMarketing(
  _prev: UnsubscribeState,
  formData: FormData
): Promise<UnsubscribeState> {
  const ip = getClientIp(await headers());
  const t = await getActionT('legal');
  if (!(await unsubLimiter.check(ip))) {
    return { status: 'error', message: t('unsubscribe.results.RATE_LIMITED') };
  }

  const parsed = unsubscribeSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: t('unsubscribe.results.INVALID_EMAIL') };
  }

  const resend = getResendClient();
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!resend || !audienceId) {
    console.error('Marketing unsubscribe is not configured: missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    return { status: 'error', message: t('unsubscribe.results.UNAVAILABLE') };
  }

  const email = parsed.data.email;
  const sent: UnsubscribeState = { status: 'success', message: t('unsubscribe.results.LINK_SENT') };
  // Checked before the provider is asked anything: a refusal looks like success
  // and sends nothing, so the answer never depends on whether the address is listed.
  if (!(await unsubEmailLimiter.check(emailKey(email)))) return sent;

  // Looked up and sent after the response. Waiting for the email only when the
  // address is listed made that answer measurably slower (and a failed send
  // visible), which told anyone timing the form who is subscribed.
  after(async () => {
    try {
      const contact = await resend.contacts.get({ email, audienceId });
      if (contact.error) {
        // Never subscribed: already not receiving marketing, and no contact is created.
        if (isNotFound(contact.error)) return;
        throw new Error(contact.error.message ?? String(contact.error));
      }
      if (contact.data.unsubscribed) return;
      // In the language of the page that asked for it.
      await sendMarketingUnsubscribeConfirmation(email, t.locale);
    } catch (error) {
      console.error('Marketing unsubscribe request failed:', error);
    }
  });

  return sent;
}

/**
 * Step 2 — the emailed link's confirm button. A form POST rather than the link
 * itself, so a mail scanner that opens links cannot unsubscribe anyone.
 */
export async function confirmUnsubscribe(
  _prev: ConfirmUnsubscribeState,
  formData: FormData
): Promise<ConfirmUnsubscribeState> {
  const ip = getClientIp(await headers());
  const t = await getActionT('legal');
  if (!(await unsubLimiter.check(`confirm:${ip}`))) {
    return { status: 'error', message: t('unsubscribe.results.RATE_LIMITED') };
  }

  const token = formData.get('token');
  const email = typeof token === 'string' ? await verifyUnsubscribeToken(token) : null;
  if (!email) {
    return { status: 'error', message: t('unsubscribe.results.INVALID_LINK'), linkInvalid: true };
  }

  const resend = getResendClient();
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!resend || !audienceId) {
    console.error('Marketing unsubscribe is not configured: missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    return { status: 'error', message: t('unsubscribe.results.UNAVAILABLE') };
  }

  try {
    const update = await resend.contacts.update({ email, audienceId, unsubscribed: true });
    if (update.error) {
      // Removed from the list since the link was sent: already not receiving
      // marketing. Never create a contact here.
      if (isNotFound(update.error)) return { status: 'success', message: t('unsubscribe.results.SUCCESS') };
      throw new Error(update.error.message ?? String(update.error));
    }
  } catch (error) {
    console.error('Marketing unsubscribe failed:', error);
    return { status: 'error', message: t('unsubscribe.results.FAILED') };
  }

  return { status: 'success', message: t('unsubscribe.results.SUCCESS') };
}
