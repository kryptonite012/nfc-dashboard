import type { Session, User } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { isRecentlyAuthenticated, resolveSession } from '../services/sessions';

export interface AuthContext {
  session: Session;
  user: User;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    requestId: string;
  }
}

/** Attaches `req.auth` when a valid session cookie is presented. Never rejects by itself. */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const resolved = await resolveSession(req, res);
  if (resolved) req.auth = resolved;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
  next();
}

/** Narrowing helper for route handlers that run after {@link requireAuth}. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
  return req.auth;
}

/** Sensitive operations require the password to have been entered recently in this session. */
export function requireRecentAuth(req: Request, _res: Response, next: NextFunction) {
  const { session } = auth(req);
  if (!isRecentlyAuthenticated(session)) {
    throw new AppError('REAUTH_REQUIRED', 'Please confirm your password to continue.');
  }
  next();
}
