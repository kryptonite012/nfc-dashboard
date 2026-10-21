import { Prisma, type User } from '@prisma/client';
import {
  forgotPasswordSchema,
  loginSchema,
  reauthSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordWithCodeSchema,
  resetPasswordWithTokenSchema,
  verifyEmailSchema,
} from '@vaultledger/shared';
import { Router, type Request } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { emails } from '../emails/templates';
import { AppError } from '../lib/errors';
import { parseBody, sendData, userAgent } from '../lib/http';
import { assertStrongPassword, burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from '../lib/password';
import { looksLikeEmail, normalizePhone, requirePhone } from '../lib/phone';
import { toUserDTO } from '../lib/serialize';
import { describeUserAgent } from '../lib/user-agent';
import { auth, requireAuth } from '../middleware/auth';
import { issueCsrfToken } from '../middleware/csrf';
import { rateLimits } from '../middleware/rate-limit';
import { logActivity, notify } from '../services/activity';
import { sendEmail } from '../services/mailer';
import { clearSessionCookie, markReauthenticated, startSession } from '../services/sessions';
import { sendSms } from '../services/sms';
import {
  consumeLinkToken,
  createLinkToken,
  createOtp,
  findLinkToken,
  invalidateTokens,
  VerificationType,
  verifyOtp,
} from '../services/verification';

export const authRouter = Router();

const GENERIC_LOGIN_ERROR =
  'Incorrect sign-in details. If you have tried several times, wait 15 minutes or reset your password.';
const LOCKOUT_THRESHOLD = 5;
const MAX_LOCKOUT_MINUTES = 60;

function lockoutUntil(failedCount: number): Date | null {
  if (failedCount < LOCKOUT_THRESHOLD) return null;
  const minutes = Math.min(2 ** (failedCount - LOCKOUT_THRESHOLD), MAX_LOCKOUT_MINUTES);
  return new Date(Date.now() + minutes * 60_000);
}

/** Finds an account by email or (when phone sign-in is enabled) by verified phone number. */
async function findByIdentifier(identifier: string): Promise<User | null> {
  if (looksLikeEmail(identifier)) {
    return prisma.user.findUnique({ where: { email: identifier.trim().toLowerCase() } });
  }
  if (!config.phoneAuthEnabled) return null;
  const phone = normalizePhone(identifier);
  return phone ? prisma.user.findUnique({ where: { phone } }) : null;
}

async function recordFailedLogin(user: User, req: Request) {
  const failed = user.failedLoginCount + 1;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 }, lockedUntil: lockoutUntil(failed) },
  });
  await logActivity({ userId: user.id, type: 'auth.login_failed', summary: 'Failed sign-in attempt' }, req);
  if (failed === LOCKOUT_THRESHOLD) {
    await notify(user.id, {
      kind: 'security',
      title: 'Repeated failed sign-in attempts',
      body: 'Several incorrect passwords were entered for your account, so sign-in was temporarily paused. If this was not you, consider changing your password.',
      link: '/app/security',
    });
  }
}

/** Applies a new password, verifies the email if proven, and signs out every session. */
async function applyPasswordReset(user: User, password: string, req: Request, proofOfEmail: boolean) {
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        ...(proofOfEmail && !user.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
      },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await logActivity({ userId: user.id, type: 'auth.password_reset', summary: 'Password reset; all sessions signed out' }, req, tx);
    await notify(
      user.id,
      { kind: 'security', title: 'Password reset', body: 'Your password was reset and all devices were signed out.', link: '/app/security' },
      tx,
    );
  });
  await invalidateTokens(user.id, [VerificationType.PASSWORD_RESET, VerificationType.PHONE_PASSWORD_RESET]);
  sendEmail(emails.passwordChangedNotice(user.email, user.name));
}

authRouter.get('/csrf', (req, res) => {
  sendData(res, { csrfToken: issueCsrfToken(req, res) });
});

authRouter.get('/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendData(res, { user: req.auth ? toUserDTO(req.auth.user) : null });
});

authRouter.post('/register', rateLimits.register, async (req, res) => {
  const input = parseBody(registerSchema, req);

  let phone: string | null = null;
  if (input.phone) {
    if (!config.phoneAuthEnabled) {
      throw new AppError('VALIDATION_FAILED', 'Phone numbers are not supported', { phone: 'Phone sign-up is not available' });
    }
    phone = requirePhone(input.phone);
  } else if (config.REQUIRE_PHONE_ON_SIGNUP) {
    throw new AppError('VALIDATION_FAILED', 'Phone number is required', { phone: 'Phone number is required' });
  }

  await assertStrongPassword(input.password, [input.name, input.email]);
  // Hash before checking for an existing account so both paths take the same time.
  const passwordHash = await hashPassword(input.password);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing) {
    // Never reveal that the address is registered: tell the owner by email instead.
    sendEmail(emails.accountAlreadyExists(existing.email, existing.name));
  } else {
    try {
      const user = await prisma.user.create({
        data: { name: input.name, email: input.email, pendingPhone: phone, passwordHash, termsAcceptedAt: new Date() },
      });
      await logActivity({ userId: user.id, type: 'auth.register', summary: 'Account created' }, req);
      const token = await createLinkToken(user.id, VerificationType.EMAIL_VERIFY, user.email);
      sendEmail(emails.verifyEmail(user.email, user.name, token));
    } catch (error) {
      // A concurrent registration for the same address: respond exactly as above.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }

  sendData(res, { message: 'Check your inbox for a link to verify your email address.' }, 202);
});

authRouter.post('/verify-email', rateLimits.verification, async (req, res) => {
  const { token } = parseBody(verifyEmailSchema, req);
  const record = await consumeLinkToken(token, [VerificationType.EMAIL_VERIFY, VerificationType.EMAIL_CHANGE]);
  if (!record) throw new AppError('INVALID_CODE', 'This link is invalid or has expired. Request a new one.');

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) throw new AppError('INVALID_CODE', 'This link is invalid or has expired. Request a new one.');

  if (record.type === VerificationType.EMAIL_VERIFY) {
    if (record.target !== user.email) throw new AppError('INVALID_CODE', 'This link is no longer valid.');
    if (!user.emailVerifiedAt) {
      await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      await logActivity({ userId: user.id, type: 'auth.email_verified', summary: 'Email address verified' }, req);
    }
    sendData(res, { kind: 'verified' as const });
    return;
  }

  // EMAIL_CHANGE: the link proves control of the new address.
  if (user.pendingEmail !== record.target) throw new AppError('INVALID_CODE', 'This link is no longer valid.');
  const previousEmail = user.email;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { email: record.target, pendingEmail: null, emailVerifiedAt: new Date() },
      });
      await logActivity(
        { userId: user.id, type: 'auth.email_changed', summary: 'Sign-in email address changed', metadata: { from: previousEmail, to: record.target } },
        req,
        tx,
      );
      await notify(
        user.id,
        { kind: 'security', title: 'Email address changed', body: `Your sign-in email is now ${record.target}.`, link: '/app/security' },
        tx,
      );
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', 'That email address can no longer be used. Try a different one.');
    }
    throw error;
  }
  sendEmail(emails.emailChangedNotice(previousEmail, user.name, record.target));
  sendData(res, { kind: 'changed' as const });
});

authRouter.post('/resend-verification', rateLimits.resendVerification, async (req, res) => {
  const { email } = parseBody(resendVerificationSchema, req);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt) {
    const token = await createLinkToken(user.id, VerificationType.EMAIL_VERIFY, user.email);
    sendEmail(emails.verifyEmail(user.email, user.name, token));
  }
  sendData(res, { message: 'If that address needs verification, a new link is on its way.' }, 202);
});

authRouter.post('/login', rateLimits.loginByIp, rateLimits.loginByIdentifier, async (req, res) => {
  const input = parseBody(loginSchema, req);
  if (!looksLikeEmail(input.identifier) && !config.phoneAuthEnabled) {
    throw new AppError('VALIDATION_FAILED', 'Sign in with your email address', { identifier: 'Enter your email address' });
  }

  const user = await findByIdentifier(input.identifier);
  if (!user) {
    await burnPasswordCheck(input.password);
    throw new AppError('INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await burnPasswordCheck(input.password);
    throw new AppError('INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    await recordFailedLogin(user, req);
    throw new AppError('INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
  }

  // Only reachable with the correct password, so this does not enable enumeration.
  if (!user.emailVerifiedAt) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'Verify your email address before signing in. Check your inbox or request a new link.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(input.password) } : {}),
    },
  });

  const ua = userAgent(req);
  const seenBefore = await prisma.activityLog.findFirst({
    where: { userId: user.id, type: 'auth.login', userAgent: ua, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
    select: { id: true },
  });

  await startSession(req, res, user.id, input.remember);
  await logActivity({ userId: user.id, type: 'auth.login', summary: `Signed in (${describeUserAgent(ua)})` }, req);
  if (!seenBefore) {
    await notify(user.id, {
      kind: 'security',
      title: 'New sign-in',
      body: `Your account was accessed from ${describeUserAgent(ua)}. If this was not you, revoke the session and change your password.`,
      link: '/app/security',
    });
  }

  sendData(res, { user: toUserDTO({ ...user, failedLoginCount: 0, lockedUntil: null }) });
});

authRouter.post('/logout', async (req, res) => {
  if (req.auth) {
    await prisma.session.deleteMany({ where: { id: req.auth.session.id } });
    await logActivity({ userId: req.auth.user.id, type: 'auth.logout', summary: 'Signed out' }, req);
  }
  clearSessionCookie(res);
  sendData(res, { ok: true });
});

authRouter.post('/password/forgot', rateLimits.passwordResetByIp, rateLimits.passwordResetByIdentifier, async (req, res) => {
  const { identifier } = parseBody(forgotPasswordSchema, req);
  const user = await findByIdentifier(identifier);

  if (user) {
    if (looksLikeEmail(identifier)) {
      const token = await createLinkToken(user.id, VerificationType.PASSWORD_RESET, user.email);
      sendEmail(emails.passwordReset(user.email, user.name, token));
    } else if (user.phone) {
      try {
        const code = await createOtp(user.id, VerificationType.PHONE_PASSWORD_RESET, user.phone);
        sendSms(user.phone, `${code} is your ${config.APP_NAME} password reset code. It expires in 10 minutes. Never share it.`);
      } catch (error) {
        // Swallow the resend cooldown so the response is identical for unknown accounts.
        if (!(error instanceof AppError && error.code === 'RATE_LIMITED')) throw error;
      }
    }
  }

  sendData(
    res,
    {
      message: 'If an account matches, we have sent password reset instructions.',
      channel: looksLikeEmail(identifier) ? 'email' : 'sms',
    },
    202,
  );
});

authRouter.post('/password/reset', rateLimits.verification, async (req, res) => {
  const input = parseBody(resetPasswordWithTokenSchema, req);
  const invalidLink = new AppError('INVALID_CODE', 'This reset link is invalid or has expired. Request a new one.');
  const record = await findLinkToken(input.token, [VerificationType.PASSWORD_RESET]);
  const user = record ? await prisma.user.findUnique({ where: { id: record.userId } }) : null;
  if (!record || !user || record.target !== user.email) throw invalidLink;
  // Check strength before consuming so that a rejected password does not burn the single-use link.
  await assertStrongPassword(input.password, [user.name, user.email]);
  if (!(await consumeLinkToken(input.token, [VerificationType.PASSWORD_RESET]))) throw invalidLink;
  await applyPasswordReset(user, input.password, req, true);
  clearSessionCookie(res);
  sendData(res, { message: 'Your password has been reset. Sign in with your new password.' });
});

authRouter.post('/password/reset-with-code', rateLimits.otpVerify, async (req, res) => {
  if (!config.phoneAuthEnabled) throw new AppError('FEATURE_DISABLED', 'Phone password reset is not available.');
  const input = parseBody(resetPasswordWithCodeSchema, req);
  const phone = normalizePhone(input.phone);
  const user = phone ? await prisma.user.findUnique({ where: { phone } }) : null;
  if (!user) throw new AppError('INVALID_CODE', 'That code is incorrect or has expired.', { code: 'That code is incorrect or has expired.' });

  await assertStrongPassword(input.password, [user.name, user.email]);
  await verifyOtp(user.id, VerificationType.PHONE_PASSWORD_RESET, input.code);
  await applyPasswordReset(user, input.password, req, false);
  clearSessionCookie(res);
  sendData(res, { message: 'Your password has been reset. Sign in with your new password.' });
});

/** Re-enter the password to unlock sensitive actions for a few minutes. */
authRouter.post('/reauth', requireAuth, rateLimits.sensitive, async (req, res) => {
  const { user, session } = auth(req);
  const { password } = parseBody(reauthSchema, req);
  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordFailedLogin(user, req);
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect password.', { password: 'Incorrect password' });
  }
  await markReauthenticated(session.id);
  sendData(res, { ok: true });
});

