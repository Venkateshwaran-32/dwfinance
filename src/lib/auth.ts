import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";
import { db } from "./db";

const COOKIE = "dw_session";
const secret = new TextEncoder().encode(env.AUTH_SECRET);
const BCRYPT_COST = 12;

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw.slice(0, 72), BCRYPT_COST); // 72-byte cap
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw.slice(0, 72), hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.uid !== "string") return null;
    // A valid signature for an account that no longer exists (deleted or reset) counts as signed out.
    const user = await db.user.findUnique({ where: { id: payload.uid }, select: { id: true } });
    return user ? user.id : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
