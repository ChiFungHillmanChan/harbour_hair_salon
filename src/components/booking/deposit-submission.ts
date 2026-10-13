/**
 * Which card authorization a "Confirm" sends. Every new card tokenization
 * gets a new attempt key (the server authorizes each key at most once). The
 * SAME key and token are sent again only to retry a submission whose answer
 * never arrived (the call itself failed), or that the server is still
 * settling (PAYMENT_PENDING): the server then answers with the first
 * outcome instead of holding the card twice. Any other answer settles it.
 */
export type DepositSubmission = {
  attemptKey: string;
  token: string;
  fingerprint: string;
  /** PAYMENT_PENDING answers in a row for this submission (see afterDepositAnswer). */
  pendingAnswers: number;
};

/** What a token was made for. A different booking, time or amount needs a new token and key. */
export function submissionFingerprint(request: { serviceId: string; stylistId: string; date: string; time: string; depositPence: number }): string {
  return JSON.stringify([request.serviceId, request.stylistId, request.date, request.time, request.depositPence]);
}

/** The pending submission when it is for this same request, else null: tokenize the card again. */
export function reusableSubmission(pending: DepositSubmission | null, fingerprint: string): DepositSubmission | null {
  return pending && pending.fingerprint === fingerprint ? pending : null;
}

/** After an answer: keep the submission (to retry it as is) only while the server is still settling it. */
export function keepSubmissionAfter(answer: { success: boolean; code?: string }): boolean {
  return !answer.success && answer.code === 'PAYMENT_PENDING';
}

/**
 * PAYMENT_PENDING answers in a row after which the page stops sending the
 * same submission. The server says PAYMENT_PENDING while the first try is
 * still with Square (INITIATED); one that stays there was left unsettled (a
 * crash, a lost database write) and only reconciliation moves it on, which
 * releases any hold it placed. Sending it again would only repeat the answer.
 */
export const MAX_PENDING_ANSWERS = 2;

/**
 * What the page keeps after an answer to a card submission. `keep`: the
 * submission to send again unchanged (still being settled), else null — the
 * next confirm tokenizes the card afresh under a new attempt key. `stuck`:
 * dropped after MAX_PENDING_ANSWERS PAYMENT_PENDING answers in a row; the
 * customer is asked to check My Bookings and reload before trying again.
 */
export function afterDepositAnswer(submission: DepositSubmission, answer: { success: boolean; code?: string }): { keep: DepositSubmission | null; stuck: boolean } {
  if (!keepSubmissionAfter(answer)) return { keep: null, stuck: false };
  const pendingAnswers = submission.pendingAnswers + 1;
  if (pendingAnswers >= MAX_PENDING_ANSWERS) return { keep: null, stuck: true };
  return { keep: { ...submission, pendingAnswers }, stuck: false };
}

/** Answers about the card, not the time: no reason to re-read the diary. */
export const PAYMENT_ANSWER_CODES: ReadonlySet<string> = new Set([
  'PAYMENT_REQUIRED', 'PAYMENT_UNAVAILABLE', 'CARD_DECLINED', 'PAYMENT_UNCERTAIN', 'PAYMENT_PENDING', 'QUOTE_CHANGED',
]);
