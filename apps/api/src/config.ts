import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Load a local .env file in development. Production and test values must come from the real environment.
const envFile = path.resolve(process.cwd(), '.env');
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((value) => (value === undefined ? fallback : ['true', '1', 'yes'].includes(value)));

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default(isTest ? 'silent' : 'info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    /** Public origin of the web application, used for links in emails and the CORS/CSRF origin check. */
    APP_URL: z.url().default('http://localhost:5173'),
    /** Additional comma-separated origins allowed to call the API with credentials. */
    EXTRA_ALLOWED_ORIGINS: z.string().default(''),
    APP_NAME: z.string().default('VaultLedger'),

    /** Secret key (≥ 32 chars) used to HMAC one-time codes before storage. */
    TOKEN_PEPPER: z.string().min(32, 'TOKEN_PEPPER must be at least 32 characters'),

    COOKIE_SECURE: bool(isProduction),
    /** Number of reverse-proxy hops to trust for client IP addresses (Express "trust proxy"). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    REMEMBER_ME_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_ROTATION_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    REAUTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),

    EMAIL_TRANSPORT: z.enum(['smtp', 'outbox']).default(isProduction ? 'smtp' : 'outbox'),
    EMAIL_FROM: z.string().default('VaultLedger <no-reply@localhost>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_OUTBOX_DIR: z.string().default('.mail-outbox'),

    SMS_PROVIDER: z.enum(['disabled', 'twilio', 'outbox']).default('disabled'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
    TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
    SMS_OUTBOX_DIR: z.string().default('.sms-outbox'),
    REQUIRE_PHONE_ON_SIGNUP: bool(false),
    /** Region used to interpret phone numbers entered without a country code. */
    DEFAULT_PHONE_REGION: z.string().length(2).default('IN'),

    /** Query the Have I Been Pwned range API (k-anonymity) for breached passwords. */
    HIBP_ENABLED: bool(false),

    /** Optional directory containing the built web app; when set, the API also serves the SPA. */
    WEB_DIST_DIR: z.string().optional(),

    RATE_LIMIT_ENABLED: bool(!isTest),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST is required when EMAIL_TRANSPORT=smtp' });
    }
    if (env.SMS_PROVIDER === 'twilio') {
      for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when SMS_PROVIDER=twilio` });
      }
      if (!env.TWILIO_FROM_NUMBER && !env.TWILIO_MESSAGING_SERVICE_SID) {
        ctx.addIssue({
          code: 'custom',
          path: ['TWILIO_FROM_NUMBER'],
          message: 'Set TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID when SMS_PROVIDER=twilio',
        });
      }
    }
    if (env.REQUIRE_PHONE_ON_SIGNUP && env.SMS_PROVIDER === 'disabled') {
      ctx.addIssue({
        code: 'custom',
        path: ['REQUIRE_PHONE_ON_SIGNUP'],
        message: 'REQUIRE_PHONE_ON_SIGNUP needs an SMS provider (SMS_PROVIDER) to verify numbers',
      });
    }
    if (env.NODE_ENV === 'production') {
      // Development conveniences must never be active in production.
      if (env.EMAIL_TRANSPORT === 'outbox') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_TRANSPORT'], message: 'The outbox email transport is not allowed in production' });
      }
      if (env.SMS_PROVIDER === 'outbox') {
        ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'The outbox SMS provider is not allowed in production' });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE must be true in production' });
      }
      const appUrl = new URL(env.APP_URL);
      // Plain http is only tolerated for a local production preview (browsers treat localhost as secure).
      if (appUrl.protocol !== 'https:' && appUrl.hostname !== 'localhost') {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must use https:// in production' });
      }
      if (!env.RATE_LIMIT_ENABLED) {
        ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_ENABLED'], message: 'Rate limiting cannot be disabled in production' });
      }
    }
  });

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`).join('\n');
    // Printing variable names and rule violations only; never values.
    console.error(`Invalid server configuration:\n${details}`);
    process.exit(1);
  }
  const env = parsed.data;
  const appOrigin = new URL(env.APP_URL).origin;
  const allowedOrigins = new Set(
    [appOrigin, ...env.EXTRA_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)].map(
      (value) => new URL(value).origin,
    ),
  );

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    appOrigin,
    allowedOrigins,
    /** `__Host-` cookies are bound to the exact host and require Secure; only usable over HTTPS. */
    cookiePrefix: env.COOKIE_SECURE ? '__Host-' : '',
    phoneAuthEnabled: env.SMS_PROVIDER !== 'disabled',
  };
}

export const config = loadConfig();
export type Config = typeof config;
