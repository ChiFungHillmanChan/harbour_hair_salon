'use server';

import { z } from 'zod';
import { Resend } from 'resend';

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

export async function unsubscribeFromMarketing(
  _prev: UnsubscribeState,
  formData: FormData
): Promise<UnsubscribeState> {
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
    if (update.error) throw new Error(update.error.message ?? String(update.error));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not.?found|does not exist|could not find/i.test(message)) {
      console.error('Marketing unsubscribe failed:', error);
      return { status: 'error', message: 'Unsubscribe failed. Please try again later.' };
    }

    const created = await resend.contacts.create({
      email: parsed.data.email,
      audienceId,
      unsubscribed: true,
    });
    if (created.error) {
      console.error('Marketing unsubscribe create-as-unsubscribed failed:', created.error);
      return { status: 'error', message: 'Unsubscribe failed. Please try again later.' };
    }
  }

  return { status: 'success', message: 'You have been unsubscribed from marketing emails.' };
}
