import { hash, verify } from '@node-rs/argon2';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { logger } from '../logger';
import { AppError } from './errors';

/** OWASP-recommended Argon2id baseline: 19 MiB memory, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id (a const enum, which cannot be imported under verbatimModuleSyntax)
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
  graphs: zxcvbnCommon.adjacencyGraphs,
  translations: zxcvbnEn.translations,
});

export function hashPassword(password: string): Promise<string> {
  return hash(password.normalize('NFKC'), ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password.normalize('NFKC'));
  } catch {
    return false;
  }
}

/** True when a stored hash was produced with weaker parameters than the current policy. */
export function needsRehash(passwordHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  if (!match) return true;
  const [, m, t, p] = match.map(Number);
  return m! < ARGON2_OPTIONS.memoryCost || t! < ARGON2_OPTIONS.timeCost || p! !== ARGON2_OPTIONS.parallelism;
}

let dummyHash: Promise<string> | undefined;

/**
 * Performs a full Argon2 verification against a throwaway hash so that a login
 * for an unknown account takes as long as one for a real account.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
}

/**
 * Rejects guessable and known-breached passwords. Throws an AppError with
 * user-facing feedback when the password is not acceptable.
 */
export async function assertStrongPassword(password: string, userInputs: string[] = []): Promise<void> {
  const inputs = userInputs.flatMap((value) => [value, ...value.split(/[@.\s_-]+/)]).filter((value) => value.length >= 3);
  const result = zxcvbn.check(password, inputs);
  if (result.score < 3) {
    const hint = result.feedback.warning || result.feedback.suggestions[0] || 'Add more words or characters that are hard to guess.';
    throw new AppError('WEAK_PASSWORD', 'This password is too easy to guess.', { password: `Too easy to guess. ${hint}`.trim() });
  }
  if (config.HIBP_ENABLED && (await isBreachedPassword(password))) {
    throw new AppError('WEAK_PASSWORD', 'This password has appeared in a known data breach.', {
      password: 'This password has appeared in a known data breach. Choose a different one.',
    });
  }
}

/**
 * Have I Been Pwned range query using k-anonymity: only the first five hex
 * characters of the SHA-1 hash leave the server. Fails open if the service is
 * unreachable so that sign-up is not blocked by a third-party outage.
 */
async function isBreachedPassword(password: string): Promise<boolean> {
  const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': `${config.APP_NAME}-password-check` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`HIBP responded with ${response.status}`);
    const body = await response.text();
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':');
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Breached-password check unavailable; skipping');
    return false;
  }
}
