import bcrypt from 'bcryptjs';

/**
 * bcrypt only reads the first 72 BYTES of its input and silently ignores the
 * rest, so two passwords that share those bytes hash identically. Refuse longer
 * NEW passwords rather than accept characters that add no protection. Bytes,
 * not characters: an accented letter takes two, a Chinese character three.
 *
 * Only applies when a password is SET. Sign-in keeps accepting whatever was
 * stored before this rule existed — bcrypt truncates both sides the same way.
 */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function fitsBcryptLimit(password: string): boolean {
  return new TextEncoder().encode(password).length <= BCRYPT_MAX_PASSWORD_BYTES;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
