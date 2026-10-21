import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import { config } from '../config';
import { sha256 } from '../lib/crypto';

/**
 * Rate limits use the in-memory store, which is correct for a single API
 * instance. When running several instances behind a load balancer, plug in a
 * shared store (e.g. rate-limit-redis) — see docs/DEPLOYMENT.md.
 */
function limiter(options: Partial<Options> & { windowMs: number; limit: number; message: string }) {
  if (!config.RATE_LIMIT_ENABLED) return (_req: Request, _res: Response, next: NextFunction) => next();
  const { message, ...rest } = options;
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...rest,
    handler: (req, res, _next, opts) => {
      res.status(opts.statusCode).json({ error: { code: 'RATE_LIMITED', message, requestId: req.requestId } });
    },
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? '0.0.0.0');

/** Keys by IP + a hash of the submitted identifier, so one account cannot be hammered from many IPs cheaply. */
const identifierKey = (field: string) => (req: Request) => {
  const raw = typeof req.body?.[field] === 'string' ? req.body[field].trim().toLowerCase() : '';
  return `id:${sha256(raw).slice(0, 32)}`;
};

const FIFTEEN_MINUTES = 15 * 60_000;
const HOUR = 60 * 60_000;

export const rateLimits = {
  api: limiter({ windowMs: 5 * 60_000, limit: 1000, keyGenerator: ipKey, message: 'Too many requests. Please slow down.' }),
  loginByIp: limiter({ windowMs: FIFTEEN_MINUTES, limit: 30, keyGenerator: ipKey, message: 'Too many sign-in attempts. Try again in a few minutes.' }),
  loginByIdentifier: limiter({
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    keyGenerator: identifierKey('identifier'),
    message: 'Too many sign-in attempts. Try again in a few minutes.',
  }),
  register: limiter({ windowMs: HOUR, limit: 10, keyGenerator: ipKey, message: 'Too many sign-up attempts. Try again later.' }),
  passwordResetByIp: limiter({ windowMs: HOUR, limit: 10, keyGenerator: ipKey, message: 'Too many reset requests. Try again later.' }),
  passwordResetByIdentifier: limiter({
    windowMs: HOUR,
    limit: 3,
    keyGenerator: identifierKey('identifier'),
    message: 'Too many reset requests. Try again later.',
  }),
  verification: limiter({ windowMs: FIFTEEN_MINUTES, limit: 20, keyGenerator: ipKey, message: 'Too many verification attempts. Try again later.' }),
  resendVerification: limiter({ windowMs: HOUR, limit: 5, keyGenerator: ipKey, message: 'Too many emails requested. Try again later.' }),
  otpSend: limiter({ windowMs: HOUR, limit: 5, keyGenerator: ipKey, message: 'Too many codes requested. Try again later.' }),
  otpVerify: limiter({ windowMs: FIFTEEN_MINUTES, limit: 15, keyGenerator: ipKey, message: 'Too many attempts. Try again later.' }),
  sensitive: limiter({ windowMs: FIFTEEN_MINUTES, limit: 20, keyGenerator: ipKey, message: 'Too many attempts. Try again later.' }),
  export: limiter({ windowMs: FIFTEEN_MINUTES, limit: 30, keyGenerator: ipKey, message: 'Too many exports. Try again shortly.' }),
  import: limiter({ windowMs: FIFTEEN_MINUTES, limit: 20, keyGenerator: ipKey, message: 'Too many imports. Try again shortly.' }),
};
