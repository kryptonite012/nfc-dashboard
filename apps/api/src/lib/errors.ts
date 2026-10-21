import type { ApiErrorCode } from '@vaultledger/shared';
import type { ZodError } from 'zod';

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_VERIFIED: 403,
  REAUTH_REQUIRED: 403,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  FEATURE_DISABLED: 404,
  WEAK_PASSWORD: 422,
  INVALID_CODE: 400,
  INTERNAL: 500,
};

/** An error whose code and message are safe to show to the client. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    status?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status ?? DEFAULT_STATUS[code];
  }
}

export const notFound = (what = 'Record') => new AppError('NOT_FOUND', `${what} not found`);

export function validationError(error: ZodError, message = 'Please correct the highlighted fields'): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return new AppError('VALIDATION_FAILED', message, fields);
}
