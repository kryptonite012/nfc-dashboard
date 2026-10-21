import { Prisma } from '@prisma/client';
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  phoneStartSchema,
  phoneVerifySchema,
  updateProfileSchema,
  updateSettingsSchema,
  type SessionDTO,
} from '@vaultledger/shared';
import { Router } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { emails } from '../emails/templates';
import { AppError } from '../lib/errors';
import { idParam, parseBody, sendData } from '../lib/http';
import { assertStrongPassword, hashPassword, verifyPassword } from '../lib/password';
import { maskPhone, requirePhone } from '../lib/phone';
import { toUserDTO } from '../lib/serialize';
import { describeUserAgent } from '../lib/user-agent';
import { auth, requireAuth, requireRecentAuth } from '../middleware/auth';
import { rateLimits } from '../middleware/rate-limit';
import { logActivity, notify } from '../services/activity';
import { sendEmail } from '../services/mailer';
import { clearSessionCookie, revokeOtherSessions, revokeSession, rotateSessionNow } from '../services/sessions';
import { assertSmsEnabled, sendSms } from '../services/sms';
import { createLinkToken, createOtp, invalidateTokens, VerificationType, verifyOtp } from '../services/verification';

export const accountRouter = Router();
accountRouter.use(requireAuth);

async function assertPassword(passwordHash: string, password: string) {
  if (!(await verifyPassword(passwordHash, password))) {
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect password.', { password: 'Incorrect password', currentPassword: 'Incorrect password' });
  }
}

accountRouter.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendData(res, toUserDTO(auth(req).user));
});

accountRouter.patch('/profile', async (req, res) => {
  const { user } = auth(req);
  const { name } = parseBody(updateProfileSchema, req);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { name } });
  await logActivity({ userId: user.id, type: 'account.profile_updated', summary: 'Profile name updated' }, req);
  sendData(res, toUserDTO(updated));
});

accountRouter.patch('/settings', async (req, res) => {
  const { user } = auth(req);
  const settings = parseBody(updateSettingsSchema, req);
  const updated = await prisma.user.update({ where: { id: user.id }, data: settings });
  await logActivity(
    { userId: user.id, type: 'account.settings_updated', summary: 'Preferences updated', metadata: { changed: Object.keys(settings) } },
    req,
  );
  sendData(res, toUserDTO(updated));
});

accountRouter.post('/password', rateLimits.sensitive, async (req, res) => {
  const { user, session } = auth(req);
  const input = parseBody(changePasswordSchema, req);
  await assertPassword(user.passwordHash, input.currentPassword);
  try {
    await assertStrongPassword(input.newPassword, [user.name, user.email]);
  } catch (error) {
    if (error instanceof AppError && error.fields?.password) {
      throw new AppError(error.code, error.message, { newPassword: error.fields.password });
    }
    throw error;
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: user.id, NOT: { id: session.id } } });
    await logActivity({ userId: user.id, type: 'auth.password_changed', summary: 'Password changed; other sessions signed out' }, req, tx);
    await notify(user.id, { kind: 'security', title: 'Password changed', body: 'Your password was changed and other devices were signed out.' }, tx);
  });
  await invalidateTokens(user.id, [VerificationType.PASSWORD_RESET, VerificationType.PHONE_PASSWORD_RESET]);
  // Privilege change: issue a fresh session token for this device.
  await rotateSessionNow(res, session);
  sendEmail(emails.passwordChangedNotice(user.email, user.name));
  sendData(res, { message: 'Password updated. Other devices have been signed out.' });
});

accountRouter.post('/email', rateLimits.sensitive, async (req, res) => {
  const { user } = auth(req);
  const { newEmail, password } = parseBody(changeEmailSchema, req);
  await assertPassword(user.passwordHash, password);
  if (newEmail === user.email) {
    throw new AppError('VALIDATION_FAILED', 'That is already your email address', { newEmail: 'That is already your email address' });
  }

  const taken = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (!taken) {
    await prisma.user.update({ where: { id: user.id }, data: { pendingEmail: newEmail } });
    const token = await createLinkToken(user.id, VerificationType.EMAIL_CHANGE, newEmail);
    sendEmail(emails.confirmEmailChange(newEmail, user.name, token));
  }
  // Same response whether or not the address belongs to someone else.
  sendData(res, { message: `If ${newEmail} can be used, a confirmation link has been sent to it.`, pendingEmail: newEmail }, 202);
});

accountRouter.delete('/email/pending', async (req, res) => {
  const { user } = auth(req);
  await prisma.user.update({ where: { id: user.id }, data: { pendingEmail: null } });
  await invalidateTokens(user.id, [VerificationType.EMAIL_CHANGE]);
  sendData(res, { ok: true });
});

accountRouter.post('/phone/start', rateLimits.otpSend, async (req, res) => {
  assertSmsEnabled();
  const { user } = auth(req);
  const input = parseBody(phoneStartSchema, req);
  const phone = requirePhone(input.phone);
  if (phone === user.phone) {
    throw new AppError('VALIDATION_FAILED', 'This number is already verified', { phone: 'This number is already verified on your account' });
  }
  const code = await createOtp(user.id, VerificationType.PHONE_VERIFY, phone);
  await prisma.user.update({ where: { id: user.id }, data: { pendingPhone: phone } });
  sendSms(phone, `${code} is your ${config.APP_NAME} verification code. It expires in 10 minutes. Never share it.`);
  sendData(res, { message: `We sent a 6-digit code to ${maskPhone(phone)}.` }, 202);
});

accountRouter.post('/phone/verify', rateLimits.otpVerify, async (req, res) => {
  assertSmsEnabled();
  const { user } = auth(req);
  const { code } = parseBody(phoneVerifySchema, req);
  const record = await verifyOtp(user.id, VerificationType.PHONE_VERIFY, code);
  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { phone: record.target, phoneVerifiedAt: new Date(), pendingPhone: null },
    });
    await logActivity({ userId: user.id, type: 'auth.phone_verified', summary: `Phone number ${maskPhone(record.target)} verified` }, req);
    await notify(user.id, { kind: 'security', title: 'Phone number verified', body: `You can now sign in with ${maskPhone(record.target)}.` });
    sendData(res, toUserDTO(updated));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', 'This number is already linked to another account.', { code: 'This number is linked to another account' });
    }
    throw error;
  }
});

accountRouter.delete('/phone', requireRecentAuth, async (req, res) => {
  const { user } = auth(req);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { phone: null, phoneVerifiedAt: null, pendingPhone: null },
  });
  await invalidateTokens(user.id, [VerificationType.PHONE_VERIFY, VerificationType.PHONE_PASSWORD_RESET]);
  await logActivity({ userId: user.id, type: 'auth.phone_removed', summary: 'Phone number removed' }, req);
  sendData(res, toUserDTO(updated));
});

accountRouter.get('/sessions', async (req, res) => {
  const { user, session: current } = auth(req);
  const sessions = await prisma.session.findMany({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: 'desc' },
  });
  const data: SessionDTO[] = sessions.map((session) => ({
    id: session.id,
    current: session.id === current.id,
    userAgent: session.userAgent,
    browser: describeUserAgent(session.userAgent),
    ipAddress: session.ipAddress,
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    persistent: session.persistent,
  }));
  sendData(res, data);
});

accountRouter.delete('/sessions/:id', async (req, res) => {
  const { user, session } = auth(req);
  const id = idParam(req);
  if (!(await revokeSession(user.id, id))) throw new AppError('NOT_FOUND', 'Session not found');
  await logActivity({ userId: user.id, type: 'auth.session_revoked', summary: 'A session was signed out', entityId: id }, req);
  if (id === session.id) clearSessionCookie(res);
  sendData(res, { ok: true, signedOut: id === session.id });
});

accountRouter.post('/sessions/revoke-others', async (req, res) => {
  const { user, session } = auth(req);
  const count = await revokeOtherSessions(user.id, session.id);
  await logActivity({ userId: user.id, type: 'auth.session_revoked', summary: `Signed out of ${count} other session(s)` }, req);
  sendData(res, { revoked: count });
});

accountRouter.delete('/', rateLimits.sensitive, async (req, res) => {
  const { user } = auth(req);
  const input = parseBody(deleteAccountSchema, req);
  await assertPassword(user.passwordHash, input.password);

  // Cascading foreign keys remove sessions, items, history, categories, activity and notifications.
  await prisma.user.delete({ where: { id: user.id } });
  clearSessionCookie(res);
  sendEmail(emails.accountDeleted(user.email, user.name));
  sendData(res, { message: 'Your account and all associated records have been permanently deleted.' });
});
