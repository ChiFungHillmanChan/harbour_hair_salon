/**
 * Rejects with `Error('timeout')` once `work` has run for `ms` without settling.
 * The work itself is not cancelled: use it where a late answer can be ignored.
 */
export function withinTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
