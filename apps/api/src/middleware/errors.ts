import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { logger } from '../logger';

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found', requestId: req.requestId } });
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

/**
 * Converts every error into the standard `{ error }` response. Unexpected
 * errors are logged with the request id and reported generically, so stack
 * traces and internal details never reach the client.
 */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if ((error as BodyParserError)?.type === 'entity.too.large') {
    appError = new AppError('PAYLOAD_TOO_LARGE', 'The request body is too large.');
  } else if ((error as BodyParserError)?.type === 'entity.parse.failed') {
    appError = new AppError('BAD_REQUEST', 'The request body is not valid JSON.');
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    appError = new AppError('CONFLICT', 'A record with these details already exists.');
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    appError = new AppError('NOT_FOUND', 'Record not found');
  } else {
    logger.error(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        err: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      },
      'Unhandled error',
    );
    appError = new AppError('INTERNAL', 'Something went wrong on our side. Please try again.');
  }

  if (res.headersSent) return;
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.fields ? { fields: appError.fields } : {}),
      requestId: req.requestId,
    },
  });
}
