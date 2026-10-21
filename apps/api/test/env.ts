/** Environment used by the integration test suite. Points at a dedicated test database. */
export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://vaultledger:vaultledger_dev@localhost:5432/vaultledger_test',
  APP_URL: 'http://localhost:5173',
  TOKEN_PEPPER: 'test-pepper-0123456789abcdef0123456789abcdef',
  EMAIL_TRANSPORT: 'outbox',
  SMS_PROVIDER: 'outbox',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false',
} as const;
