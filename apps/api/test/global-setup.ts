import { execSync } from 'node:child_process';
import { testEnv } from './env';

/** Applies pending migrations to the test database once before the suite runs (non-destructive). */
export default function setup() {
  if (!/test/i.test(new URL(testEnv.DATABASE_URL).pathname)) {
    throw new Error('Refusing to run integration tests against a database whose name does not contain "test".');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testEnv.DATABASE_URL },
  });
}
