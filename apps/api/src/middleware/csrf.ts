import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { generateToken, safeEqual } from '../lib/crypto';
import { AppError } from '../lib/errors';

/**
 * CSRF protection for the cookie-based session:
 *  1. Origin check — state-changing requests must come from an allowed origin.
 *  2. Double-submit token — the `X-CSRF-Token` header must equal the value of
 *     an HttpOnly, SameSite=Strict cookie. Only same-origin JavaScript can learn
 *     the value (via GET /api/auth/csrf), and in production the `__Host-`
 *     prefix stops sibling sub-domains from planting the cookie.
 * SameSite=Lax on the session cookie is an additional layer, not the only one.
 */
export const CSRF_COOKIE = `${config.cookiePrefix}vl_csrf`;
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(req: Request, res: Response): string {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (typeof existing === 'string' && existing.length >= 32 && existing.length <= 100) return existing;
  const token = generateToken();
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
  });
  return token;
}

function originAllowed(req: Request): boolean {
  const origin = req.get('origin');
  if (origin) return config.allowedOrigins.has(origin);
  const referer = req.get('referer');
  if (referer) {
    try {
      return config.allowedOrigins.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  // Non-browser clients send neither header; they still need the double-submit token below.
  return true;
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  if (!originAllowed(req)) throw new AppError('CSRF_FAILED', 'Request origin is not allowed.');

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (typeof cookieToken !== 'string' || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new AppError('CSRF_FAILED', 'Your security token expired. Please retry.');
  }
  next();
}
