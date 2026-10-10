/**
 * What may be logged about an unexpected failure: the error's name and code,
 * never its message. A driver or fetch message can quote the database host or
 * a private calendar-feed URL with its token. Prisma keeps a request error's
 * code in `code` but a connection failure's (e.g. P1001) in `errorCode`.
 */
export function describeFault(error: unknown): { error: string; code?: string } {
  if (!(error instanceof Error)) return { error: 'unknown' };
  const { code, errorCode } = error as { code?: unknown; errorCode?: unknown };
  const found = typeof code === 'string' ? code : typeof errorCode === 'string' ? errorCode : undefined;
  return found ? { error: error.name, code: found } : { error: error.name };
}
