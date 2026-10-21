import { expect, test } from '@playwright/test';
import { registerAndSignIn, uniqueEmail } from './helpers';

test('the app is usable on a phone-sized screen', async ({ page }) => {
  await registerAndSignIn(page, uniqueEmail('mobile'), 'Kavya');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'All Records' }).click();
  await expect(page).toHaveURL(/\/app\/records$/);
  await page.getByRole('button', { name: 'Quick add item' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Item name/).fill('Phone case');
  await dialog.getByLabel(/Unit price/).fill('799');
  await dialog.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('link', { name: 'Phone case' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
