import bcrypt from "bcryptjs";

/** Password hashing helpers (bcrypt, pure-JS implementation). */

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}
