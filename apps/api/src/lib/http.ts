import type { Request, Response } from 'express';
import type { ZodType, z } from 'zod';
import { AppError, validationError } from './errors';

export function parseBody<S extends ZodType>(schema: S, req: Request): z.output<S> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseQuery<S extends ZodType>(schema: S, req: Request): z.output<S> {
  const result = schema.safeParse(req.query);
  if (!result.success) throw validationError(result.error, 'Invalid filter values');
  return result.data;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a UUID route parameter; malformed ids are reported as "not found" to avoid probing. */
export function idParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new AppError('NOT_FOUND', 'Record not found');
  return value.toLowerCase();
}

export function sendData<T>(res: Response, data: T, status = 200, meta?: unknown) {
  res.status(status).json(meta === undefined ? { data } : { data, meta });
}

export function clientIp(req: Request): string | null {
  return req.ip ? req.ip.slice(0, 64) : null;
}

export function userAgent(req: Request): string | null {
  const value = req.get('user-agent');
  return value ? value.slice(0, 512) : null;
}
