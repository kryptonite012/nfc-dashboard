import type { Session, User } from '@prisma/client';
import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { generateToken, sha256 } from '../lib/crypto';
import { clientIp, userAgent } from '../lib/http';

const MINUTE = 60_000;
/** How long the token replaced by a rotation keeps working (covers in-flight parallel requests). */
const ROTATION_GRACE_MS = 60_000;
/** lastActiveAt is only written when it is older than this, to avoid a DB write per request. */
const ACTIVITY_WRITE_INTERVAL_MS = MINUTE;

export const SESSION_COOKIE = `${config.cookiePrefix}vl_session`;

function cookieOptions(persistent: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    ...(persistent ? { maxAge: config.REMEMBER_ME_DAYS * 24 * 60 * MINUTE } : {}),
  };
}

function absoluteLifetimeMs(persistent: boolean): number {
  return persistent ? config.REMEMBER_ME_DAYS * 24 * 60 * MINUTE : config.SESSION_ABSOLUTE_HOURS * 60 * MINUTE;
}

function idleLimitMs(session: Pick<Session, 'persistent'>): number {
  return session.persistent ? absoluteLifetimeMs(true) : config.SESSION_IDLE_MINUTES * MINUTE;
}

export function setSessionCookie(res: Response, token: string, persistent: boolean): void {
  res.cookie(SESSION_COOKIE, token, cookieOptions(persistent));
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _ignored, ...options } = cookieOptions(false);
  res.clearCookie(SESSION_COOKIE, options);
}

/**
 * Starts a brand-new session after successful authentication. Any session
 * presented by the browser is destroyed first, which prevents session fixation.
 */
export async function startSession(req: Request, res: Response, userId: string, persistent: boolean) {
  const presented = req.cookies?.[SESSION_COOKIE];
  if (typeof presented === 'string' && presented) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(presented) } });
  }

  const token = generateToken();
  const now = new Date();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      persistent,
      userAgent: userAgent(req),
      ipAddress: clientIp(req),
      authenticatedAt: now,
      rotatedAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + absoluteLifetimeMs(persistent)),
    },
  });
  setSessionCookie(res, token, persistent);
  return session;
}

export interface ResolvedSession {
  session: Session;
  user: User;
}

/**
 * Looks up the session for the presented cookie, enforcing absolute and idle
 * expiry, and transparently rotates the token once it is older than the
 * configured rotation interval.
 */
export async function resolveSession(req: Request, res: Response): Promise<ResolvedSession | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;

  const hash = sha256(token);
  const record = await prisma.session.findFirst({
    where: { OR: [{ tokenHash: hash }, { previousTokenHash: hash }] },
    include: { user: true },
  });
  if (!record) {
    clearSessionCookie(res);
    return null;
  }

  const now = Date.now();
  const usedPreviousToken = record.tokenHash !== hash;
  if (usedPreviousToken && now - record.rotatedAt.getTime() > ROTATION_GRACE_MS) {
    // A superseded token presented after the grace period may have been stolen: end the session.
    await prisma.session.deleteMany({ where: { id: record.id } });
    clearSessionCookie(res);
    return null;
  }

  const expired = record.expiresAt.getTime() <= now || record.lastActiveAt.getTime() + idleLimitMs(record) <= now;
  if (expired) {
    await prisma.session.deleteMany({ where: { id: record.id } });
    clearSessionCookie(res);
    return null;
  }

  const { user, ...session } = record;
  let current: Session = session;

  if (!usedPreviousToken && now - session.rotatedAt.getTime() > config.SESSION_ROTATION_MINUTES * MINUTE) {
    const nextToken = generateToken();
    const rotatedAt = new Date(now);
    // Conditional update: if a parallel request already rotated, this one simply does not.
    const { count } = await prisma.session.updateMany({
      where: { id: session.id, tokenHash: hash },
      data: { tokenHash: sha256(nextToken), previousTokenHash: hash, rotatedAt, lastActiveAt: rotatedAt },
    });
    if (count === 1) {
      setSessionCookie(res, nextToken, session.persistent);
      current = { ...session, tokenHash: sha256(nextToken), previousTokenHash: hash, rotatedAt, lastActiveAt: rotatedAt };
    }
  } else if (now - session.lastActiveAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
    const lastActiveAt = new Date(now);
    await prisma.session.updateMany({ where: { id: session.id }, data: { lastActiveAt } });
    current = { ...session, lastActiveAt };
  }

  return { session: current, user };
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
  return count > 0;
}

export async function revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, ...(keepSessionId ? { NOT: { id: keepSessionId } } : {}) },
  });
  return count;
}

/** True when the user entered their password in this session within the re-authentication window. */
export function isRecentlyAuthenticated(session: Session): boolean {
  return Date.now() - session.authenticatedAt.getTime() <= config.REAUTH_WINDOW_MINUTES * MINUTE;
}

export async function markReauthenticated(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { authenticatedAt: new Date() } });
}

/**
 * Issues a fresh token for the current session after a privilege change
 * (password or email change) while keeping the user signed in.
 */
export async function rotateSessionNow(res: Response, session: Session): Promise<void> {
  const token = generateToken();
  await prisma.session.update({
    where: { id: session.id },
    data: { tokenHash: sha256(token), previousTokenHash: null, rotatedAt: new Date(), authenticatedAt: new Date() },
  });
  setSessionCookie(res, token, session.persistent);
}

export async function purgeExpiredSessions(): Promise<number> {
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - config.SESSION_IDLE_MINUTES * MINUTE);
  const { count } = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { persistent: false, lastActiveAt: { lte: idleCutoff } }] },
  });
  await prisma.verificationToken.deleteMany({
    where: { OR: [{ expiresAt: { lte: new Date(now.getTime() - 24 * 60 * MINUTE) } }, { consumedAt: { not: null } }] },
  });
  return count;
}
