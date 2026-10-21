import { VerificationType, type VerificationToken } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { generateOtp, generateToken, hmacCode, safeEqual, sha256 } from '../lib/crypto';
import { AppError } from '../lib/errors';

const MINUTE = 60_000;

const TTL_MS: Record<VerificationType, number> = {
  EMAIL_VERIFY: 24 * 60 * MINUTE,
  EMAIL_CHANGE: 24 * 60 * MINUTE,
  PASSWORD_RESET: 30 * MINUTE,
  PHONE_VERIFY: 10 * MINUTE,
  PHONE_PASSWORD_RESET: 10 * MINUTE,
};

export const MAX_OTP_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60_000;

/**
 * Creates a single-use link token (256-bit, stored as SHA-256) and invalidates
 * any earlier unused token of the same type for the user.
 */
export async function createLinkToken(userId: string, type: VerificationType, target: string): Promise<string> {
  const token = generateToken();
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { userId, type, consumedAt: null } }),
    prisma.verificationToken.create({
      data: { userId, type, target, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS[type]) },
    }),
  ]);
  return token;
}

/** Returns a usable link token without consuming it. */
export async function findLinkToken(token: string, types: VerificationType[]): Promise<VerificationToken | null> {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || !types.includes(record.type) || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return record;
}

/** Atomically consumes a link token. Returns null for unknown, expired, used or wrong-type tokens. */
export async function consumeLinkToken(token: string, types: VerificationType[]): Promise<VerificationToken | null> {
  const record = await findLinkToken(token, types);
  if (!record) return null;
  const { count } = await prisma.verificationToken.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return count === 1 ? record : null;
}

/**
 * Creates a 6-digit one-time code. The code is stored as an HMAC bound to the
 * token id, expires after 10 minutes and allows {@link MAX_OTP_ATTEMPTS} guesses.
 */
export async function createOtp(userId: string, type: VerificationType, target: string): Promise<string> {
  const latest = await prisma.verificationToken.findFirst({
    where: { userId, type, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    throw new AppError('RATE_LIMITED', 'Please wait a minute before requesting another code.');
  }

  const id = randomUUID();
  const code = generateOtp();
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { userId, type, consumedAt: null } }),
    prisma.verificationToken.create({
      data: { id, userId, type, target, tokenHash: hmacCode(id, code), expiresAt: new Date(Date.now() + TTL_MS[type]) },
    }),
  ]);
  return code;
}

/** Verifies and consumes a one-time code; throws INVALID_CODE on any failure. */
export async function verifyOtp(userId: string, type: VerificationType, code: string): Promise<VerificationToken> {
  const invalid = new AppError('INVALID_CODE', 'That code is incorrect or has expired.', { code: 'That code is incorrect or has expired.' });
  const record = await prisma.verificationToken.findFirst({
    where: { userId, type, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record || record.expiresAt.getTime() <= Date.now()) throw invalid;
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    throw new AppError('INVALID_CODE', 'Too many incorrect attempts. Request a new code.', {
      code: 'Too many incorrect attempts. Request a new code.',
    });
  }

  // Count the attempt before comparing so concurrent guesses cannot exceed the limit.
  const { count } = await prisma.verificationToken.updateMany({
    where: { id: record.id, consumedAt: null, attempts: { lt: MAX_OTP_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (count !== 1) throw invalid;

  if (!safeEqual(hmacCode(record.id, code), record.tokenHash)) throw invalid;

  const consumed = await prisma.verificationToken.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw invalid;
  return record;
}

export async function invalidateTokens(userId: string, types: VerificationType[]): Promise<void> {
  await prisma.verificationToken.deleteMany({ where: { userId, type: { in: types }, consumedAt: null } });
}

export { VerificationType };
