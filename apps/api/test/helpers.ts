import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { clearOutbox, getOutbox, waitForDeliveries } from '../src/services/delivery';

export const app = createApp();
export const ORIGIN = 'http://localhost:5173';
export const STRONG_PASSWORD = 'violet-Harbor-telescope-91';
export const OTHER_STRONG_PASSWORD = 'quiet-Meadow-lantern-47';

type Headers = Record<string, string>;

/** A browser-like client: keeps cookies, sends the Origin header and the CSRF token. */
export class Client {
  readonly agent = request.agent(app);
  private csrf: string | undefined;

  async csrfToken(): Promise<string> {
    if (!this.csrf) {
      const res = await this.agent.get('/api/auth/csrf').set('Origin', ORIGIN);
      this.csrf = res.body.data.csrfToken as string;
    }
    return this.csrf;
  }

  get(url: string) {
    return this.agent.get(url).set('Origin', ORIGIN);
  }

  async post(url: string, body: object = {}, headers: Headers = {}) {
    // Fetch the token first: the agent attaches cookies when the request object is created.
    const token = await this.csrfToken();
    return this.agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', token).set(headers).send(body);
  }

  async patch(url: string, body: object = {}, headers: Headers = {}) {
    // Fetch the token first: the agent attaches cookies when the request object is created.
    const token = await this.csrfToken();
    return this.agent.patch(url).set('Origin', ORIGIN).set('X-CSRF-Token', token).set(headers).send(body);
  }

  async delete(url: string, body: object = {}, headers: Headers = {}) {
    // Fetch the token first: the agent attaches cookies when the request object is created.
    const token = await this.csrfToken();
    return this.agent.delete(url).set('Origin', ORIGIN).set('X-CSRF-Token', token).set(headers).send(body);
  }
}

export async function resetDatabase() {
  // Every user-owned table cascades from users.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
  await waitForDeliveries();
  clearOutbox();
}

export async function lastMessageTo(to: string) {
  await waitForDeliveries();
  const messages = getOutbox().filter((message) => message.to === to);
  return messages.at(-1);
}

export async function tokenFromLastEmail(to: string): Promise<string> {
  const message = await lastMessageTo(to);
  const match = message?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No token email found for ${to}`);
  return match[1];
}

export async function codeFromLastSms(to: string): Promise<string> {
  const message = await lastMessageTo(to);
  const match = message?.text.match(/^(\d{6})\b/);
  if (!match?.[1]) throw new Error(`No code SMS found for ${to}`);
  return match[1];
}

export async function registerUser(client: Client, email: string, name = 'Test User', password = STRONG_PASSWORD) {
  return client.post('/api/auth/register', { name, email, password, confirmPassword: password, acceptTerms: true });
}

/** Registers, verifies and signs in a user. Returns the signed-in client. */
export async function createSignedInUser(email: string, password = STRONG_PASSWORD, name = 'Test User') {
  const client = new Client();
  const registered = await registerUser(client, email, name, password);
  if (registered.status !== 202) throw new Error(`Registration failed: ${JSON.stringify(registered.body)}`);
  const token = await tokenFromLastEmail(email);
  const verified = await client.post('/api/auth/verify-email', { token });
  if (verified.status !== 200) throw new Error(`Verification failed: ${JSON.stringify(verified.body)}`);
  const login = await client.post('/api/auth/login', { identifier: email, password });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  return client;
}

export function sessionCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((cookie) => cookie.startsWith('vl_session='));
}
