import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@prisma/client";

/**
 * Stateless session handling via a signed JWT stored in an httpOnly cookie.
 *
 * The session carries the tenant (`auditFirmId`) and the user's role, so every
 * request can enforce isolation and RBAC without a DB round-trip. Signed with
 * AUTH_SECRET (HS256).
 */

export const SESSION_COOKIE = "audit_session";
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

export interface SessionUser {
  userId: string;
  auditFirmId: string;
  role: UserRole;
  fullNameAr: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET must be set (>= 16 chars) to sign/verify sessions.",
    );
  }
  return new TextEncoder().encode(secret);
}

/** Create a signed session token for a user. */
export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    auditFirmId: user.auditFirmId,
    role: user.role,
    fullNameAr: user.fullNameAr,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** Verify a token and return the session user, or null when invalid. */
export async function verifySessionToken(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.sub !== "string" ||
      typeof payload.auditFirmId !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.fullNameAr !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      auditFirmId: payload.auditFirmId,
      role: payload.role as UserRole,
      fullNameAr: payload.fullNameAr,
    };
  } catch {
    return null;
  }
}

/** Set the session cookie (call from a route handler / server action). */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Resolve the current session from the request cookie, or null. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
