import pino from 'pino';
import { config } from './config';

/**
 * Structured JSON logger. Any field that could carry credentials, one-time
 * codes, tokens or cookies is redacted before it is written.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'vaultledger-api' },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.confirmPassword',
      '*.token',
      '*.code',
      '*.otp',
      '*.secret',
      'password',
      'token',
      'code',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
