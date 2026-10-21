import { expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const OUTBOX = path.resolve('test-results/e2e-outbox');
export const PASSWORD = 'harbor-Velvet-compass-58';

/** Waits for the newest development-outbox message addressed to `recipient`. */
export async function latestMessage(recipient: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const files = (await readdir(OUTBOX).catch(() => [] as string[])).filter((name) => name.includes(recipient)).sort();
    const newest = files.at(-1);
    if (newest) return readFile(path.join(OUTBOX, newest), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No outbox message for ${recipient}`);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Registers through the UI, follows the emailed verification link and signs in. */
export async function registerAndSignIn(page: Page, email: string, name = 'E2E User') {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  const message = await latestMessage(email);
  const link = message.match(/(\/verify-email\?token=[\w-]+)/)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page.getByText('Your email address is verified')).toBeVisible();

  await page.goto('/login');
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
}
