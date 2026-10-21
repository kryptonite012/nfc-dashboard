import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import {
  Client,
  codeFromLastSms,
  createSignedInUser,
  lastMessageTo,
  OTHER_STRONG_PASSWORD,
  ORIGIN,
  registerUser,
  resetDatabase,
  sessionCookie,
  STRONG_PASSWORD,
  tokenFromLastEmail,
} from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('registration', () => {
  it('creates an unverified account, stores an Argon2id hash and emails a verification link', async () => {
    const client = new Client();
    const res = await registerUser(client, 'Ana@Example.com', 'Ana');
    expect(res.status).toBe(202);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@example.com' } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user.passwordHash).not.toContain(STRONG_PASSWORD);

    const token = await tokenFromLastEmail('ana@example.com');
    const stored = await prisma.verificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64);
  });

  it('does not reveal whether an email is already registered', async () => {
    await createSignedInUser('taken@example.com');
    const fresh = await registerUser(new Client(), 'new@example.com');
    const duplicate = await registerUser(new Client(), 'taken@example.com', 'Impostor');
    expect(duplicate.status).toBe(fresh.status);
    expect(duplicate.body).toEqual(fresh.body);
    expect((await lastMessageTo('taken@example.com'))?.subject).toMatch(/Sign-up attempt/);
    expect(await prisma.user.count({ where: { email: 'taken@example.com' } })).toBe(1);
  });

  it('rejects weak and mismatched passwords and missing consent', async () => {
    const client = new Client();
    const weak = await client.post('/api/auth/register', {
      name: 'W',
      email: 'w@example.com',
      password: 'password1234',
      confirmPassword: 'password1234',
      acceptTerms: true,
    });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');

    const mismatch = await client.post('/api/auth/register', {
      name: 'W',
      email: 'w@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: `${STRONG_PASSWORD}x`,
      acceptTerms: false,
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.fields).toMatchObject({ confirmPassword: expect.any(String), acceptTerms: expect.any(String) });
  });
});

describe('sign-in', () => {
  it('requires email verification before a session is issued', async () => {
    const client = new Client();
    await registerUser(client, 'pending@example.com');
    const res = await client.post('/api/auth/login', { identifier: 'pending@example.com', password: STRONG_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('issues an HttpOnly SameSite session cookie and exposes the user', async () => {
    const client = new Client();
    await registerUser(client, 'cookie@example.com');
    await client.post('/api/auth/verify-email', { token: await tokenFromLastEmail('cookie@example.com') });
    const res = await client.post('/api/auth/login', { identifier: 'cookie@example.com', password: STRONG_PASSWORD });
    expect(res.status).toBe(200);
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Max-Age/); // not "remember me": browser-session cookie

    const session = await client.get('/api/auth/session');
    expect(session.body.data.user.email).toBe('cookie@example.com');
  });

  it('returns identical errors for unknown accounts and wrong passwords', async () => {
    await createSignedInUser('real@example.com');
    const client = new Client();
    const unknown = await client.post('/api/auth/login', { identifier: 'ghost@example.com', password: STRONG_PASSWORD });
    const wrong = await client.post('/api/auth/login', { identifier: 'real@example.com', password: 'not-the-password' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('temporarily locks an account after repeated failures, even for the right password', async () => {
    await createSignedInUser('lock@example.com');
    const client = new Client();
    for (let i = 0; i < 5; i += 1) {
      await client.post('/api/auth/login', { identifier: 'lock@example.com', password: 'wrong-password-123' });
    }
    const res = await client.post('/api/auth/login', { identifier: 'lock@example.com', password: STRONG_PASSWORD });
    expect(res.status).toBe(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'lock@example.com' } });
    expect(user.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('replaces any presented session on login (no session fixation) and revokes on logout', async () => {
    const client = await createSignedInUser('fix@example.com');
    const before = await prisma.session.findMany({ where: { user: { email: 'fix@example.com' } } });
    expect(before).toHaveLength(1);

    await client.post('/api/auth/login', { identifier: 'fix@example.com', password: STRONG_PASSWORD });
    const after = await prisma.session.findMany({ where: { user: { email: 'fix@example.com' } } });
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(before[0]!.id);

    const logout = await client.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(await prisma.session.count({ where: { user: { email: 'fix@example.com' } } })).toBe(0);
    expect((await client.get('/api/auth/session')).body.data.user).toBeNull();
    expect((await client.get('/api/items')).status).toBe(401);
  });

  it('uses a persistent cookie only when "remember me" is selected', async () => {
    const client = await createSignedInUser('remember@example.com');
    const res = await client.post('/api/auth/login', { identifier: 'remember@example.com', password: STRONG_PASSWORD, remember: true });
    expect(sessionCookie(res)).toMatch(/Max-Age=\d+/);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without a valid token', async () => {
    const client = await createSignedInUser('csrf@example.com');
    const missing = await client.agent.post('/api/items').set('Origin', ORIGIN).send({ name: 'x', price: '1', currency: 'INR' });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_FAILED');

    const wrongToken = await client.agent
      .post('/api/items')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', 'a'.repeat(43))
      .send({ name: 'x', price: '1', currency: 'INR' });
    expect(wrongToken.status).toBe(403);
  });

  it('rejects requests from a foreign origin even with a token', async () => {
    const client = await createSignedInUser('origin@example.com');
    const res = await client.agent
      .post('/api/items')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', await client.csrfToken())
      .send({ name: 'x', price: '1', currency: 'INR' });
    expect(res.status).toBe(403);
    expect(await prisma.item.count()).toBe(0);
  });
});

describe('password reset', () => {
  it('resets with a single-use link, signs out every session and keeps responses generic', async () => {
    const signedIn = await createSignedInUser('reset@example.com');
    const client = new Client();

    const known = await client.post('/api/auth/password/forgot', { identifier: 'reset@example.com' });
    const unknown = await client.post('/api/auth/password/forgot', { identifier: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);

    const token = await tokenFromLastEmail('reset@example.com');
    const weak = await client.post('/api/auth/password/reset', { token, password: 'password1234', confirmPassword: 'password1234' });
    expect(weak.status).toBe(422);

    // The rejected attempt must not have consumed the link.
    const ok = await client.post('/api/auth/password/reset', {
      token,
      password: OTHER_STRONG_PASSWORD,
      confirmPassword: OTHER_STRONG_PASSWORD,
    });
    expect(ok.status).toBe(200);

    const reused = await client.post('/api/auth/password/reset', {
      token,
      password: OTHER_STRONG_PASSWORD,
      confirmPassword: OTHER_STRONG_PASSWORD,
    });
    expect(reused.status).toBe(400);

    expect((await signedIn.get('/api/items')).status).toBe(401);
    const oldLogin = await client.post('/api/auth/login', { identifier: 'reset@example.com', password: STRONG_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await client.post('/api/auth/login', { identifier: 'reset@example.com', password: OTHER_STRONG_PASSWORD });
    expect(newLogin.status).toBe(200);
  });
});

describe('phone verification and phone sign-in', () => {
  it('verifies a phone with a hashed, attempt-limited one-time code and allows phone sign-in', async () => {
    const client = await createSignedInUser('phone@example.com');
    const start = await client.post('/api/account/phone/start', { phone: '+91 98765 43210' });
    expect(start.status).toBe(202);

    const code = await codeFromLastSms('+919876543210');
    const stored = await prisma.verificationToken.findFirstOrThrow({ where: { type: 'PHONE_VERIFY' } });
    expect(stored.tokenHash).not.toContain(code);

    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await client.post('/api/account/phone/verify', { code: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CODE');

    const good = await client.post('/api/account/phone/verify', { code });
    expect(good.status).toBe(200);
    expect(good.body.data).toMatchObject({ phone: '+919876543210', phoneVerified: true });

    const replay = await client.post('/api/account/phone/verify', { code });
    expect(replay.status).toBe(400);

    const phoneLogin = await new Client().post('/api/auth/login', { identifier: '+91 98765 43210', password: STRONG_PASSWORD });
    expect(phoneLogin.status).toBe(200);
  });

  it('invalidates a code after five wrong guesses', async () => {
    const client = await createSignedInUser('otp@example.com');
    await client.post('/api/account/phone/start', { phone: '+14155550123' });
    const code = await codeFromLastSms('+14155550123');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) await client.post('/api/account/phone/verify', { code: wrong });
    const res = await client.post('/api/account/phone/verify', { code });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Too many/);
  });
});

describe('account security', () => {
  it('changing the password signs out other sessions but keeps this one', async () => {
    const first = await createSignedInUser('change@example.com');
    const second = new Client();
    await second.post('/api/auth/login', { identifier: 'change@example.com', password: STRONG_PASSWORD });
    expect((await second.get('/api/items')).status).toBe(200);

    const res = await first.post('/api/account/password', {
      currentPassword: STRONG_PASSWORD,
      newPassword: OTHER_STRONG_PASSWORD,
      confirmPassword: OTHER_STRONG_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toBeDefined(); // rotated token
    expect((await first.get('/api/items')).status).toBe(200);
    expect((await second.get('/api/items')).status).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const first = await createSignedInUser('sessions@example.com');
    const second = new Client();
    await second.post('/api/auth/login', { identifier: 'sessions@example.com', password: STRONG_PASSWORD });

    const list = await first.get('/api/account/sessions');
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((session: { current: boolean }) => !session.current);
    const revoke = await first.delete(`/api/account/sessions/${other.id}`);
    expect(revoke.status).toBe(200);
    expect((await second.get('/api/items')).status).toBe(401);
  });

  it('deletes the account and all its data only with the password and confirmation phrase', async () => {
    const client = await createSignedInUser('delete@example.com');
    await client.post('/api/items', { name: 'Lamp', price: '10', currency: 'INR' });

    const noPhrase = await client.delete('/api/account', { password: STRONG_PASSWORD, confirmation: 'yes' });
    expect(noPhrase.status).toBe(422);
    const wrongPassword = await client.delete('/api/account', { password: 'nope-nope-nope', confirmation: 'DELETE MY ACCOUNT' });
    expect(wrongPassword.status).toBe(401);

    const res = await client.delete('/api/account', { password: STRONG_PASSWORD, confirmation: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(200);
    expect(await prisma.user.count({ where: { email: 'delete@example.com' } })).toBe(0);
    expect(await prisma.item.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });
});
