import { Prisma } from '@prisma/client';

/**
 * Retrying Serializable transactions on PostgreSQL serialization failures
 * (Prisma P2034).
 *
 * Under SSI, two transactions that read what the other writes can BOTH be
 * aborted. Retried at once they start together again and can conflict again:
 * the same customer's double tap on "Request booking" failed every one of its
 * three immediate attempts in CI on 2026-10-16. Waiting a random, growing
 * interval before each retry pulls the two apart, so the second one sees the
 * first one's booking and returns it.
 */

export const SERIALIZABLE_MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 25;

/** Milliseconds to wait after the `failures`-th failure: 0.5–1.5 × 25 ms × 2^(failures − 1). */
export function serializableRetryDelayMs(failures: number, random: () => number = Math.random): number {
  const ceiling = BASE_DELAY_MS * 2 ** (failures - 1);
  return Math.round(ceiling * (0.5 + random()));
}

export function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export async function retryOnSerializationFailure<T>(
  run: () => Promise<T>,
  options: { maxAttempts?: number; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? SERIALIZABLE_MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt >= maxAttempts) throw error;
      await sleep(serializableRetryDelayMs(attempt, options.random));
    }
  }
}
