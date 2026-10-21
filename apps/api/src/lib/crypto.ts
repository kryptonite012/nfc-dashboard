import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_LENGTH } from '@vaultledger/shared';
import { config } from '../config';

/** 256-bit random token encoded as base64url (43 characters). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest. Suitable for high-entropy random tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Keyed hash for low-entropy secrets such as 6-digit codes, so that a leaked
 * database cannot be brute-forced offline without the server-side pepper.
 * The token id binds each code hash to a single verification record.
 */
export function hmacCode(scope: string, code: string): string {
  return createHmac('sha256', config.TOKEN_PEPPER).update(`${scope}:${code}`).digest('hex');
}

/** Cryptographically secure numeric one-time code. */
export function generateOtp(length = OTP_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
  return code;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
