import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function canonicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return resolve(canonicalPath(dirname(path)), basename(path));
}

function isWithin(path: string, directory: string): boolean {
  const difference = relative(directory, path);
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
}

/** No database connections; callers must pass the returned URL to Prisma explicitly. */
export function assertSafeSeedTarget(env: Partial<NodeJS.ProcessEnv>, repositoryRoot: string): string {
  if (env.SALON_ALLOW_DESTRUCTIVE_SEED !== 'true') throw new Error('Destructive seed requires explicit opt-in: SALON_ALLOW_DESTRUCTIVE_SEED=true.');
  if (env.NODE_ENV === 'production' || env.VERCEL) throw new Error('Destructive seed is forbidden in production or Vercel environments.');
  const value = env.POSTGRES_URL?.trim() || env.DATABASE_URL?.trim();
  if (!value) throw new Error('Destructive seed requires a disposable database target.');

  if (value.startsWith('file:')) {
    if (/[?#]/.test(value) || (/^file:\/\//.test(value) && !/^file:\/\/\//.test(value))) throw new Error('Seed SQLite target must be a disposable local file.');
    let path: string;
    try { path = decodeURIComponent(value.slice(5)); }
    catch { throw new Error('Seed SQLite target must be a disposable local file.'); }
    if (!/^(?:dev|test|salon_test)(?:[-_.][a-zA-Z0-9_-]+)?\.db$/.test(basename(path))) throw new Error('Seed SQLite file must have a disposable dev/test database name.');
    const target = canonicalPath(resolve(repositoryRoot, 'prisma/dev', path));
    const allowed = [resolve(repositoryRoot, 'prisma/dev'), '/private/tmp', tmpdir()].map(canonicalPath);
    if (!allowed.some((directory) => isWithin(target, directory))) throw new Error('Seed SQLite target must stay inside a disposable development directory.');
    return `file:${target}`;
  }

  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Seed database must be a disposable local target.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/salon_test' || url.searchParams.has('host')) {
    throw new Error('Seed PostgreSQL target must be localhost and named salon_test. Remote targets are forbidden.');
  }
  return value;
}
