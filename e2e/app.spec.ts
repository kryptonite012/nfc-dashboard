import { expect, test } from '@playwright/test';
import { registerAndSignIn, uniqueEmail } from './helpers';

test('a user can record, edit, delete and restore items and see accurate totals', async ({ page }) => {
  await registerAndSignIn(page, uniqueEmail('owner'), 'Meera Iyer');
  await expect(page.getByText('Add your first item')).toBeVisible();

  // Full form, then "save and add another".
  await page.goto('/app/items/new');
  await page.getByLabel(/Item name/).fill('Air purifier');
  await page.getByLabel(/Unit price/).fill('12,999.50');
  await page.getByLabel('Quantity').fill('2');
  await page.getByLabel('SKU / reference').fill('AP-77');
  await page.getByRole('button', { name: 'Save and add another' }).click();
  await expect(page.getByText('“Air purifier” saved')).toBeVisible();
  await page.getByLabel(/Item name/).fill('Desk lamp');
  await page.getByLabel(/Unit price/).fill('1499');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page).toHaveURL(/\/app\/records\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Desk lamp' })).toBeVisible();

  // Server-side validation feedback.
  await page.goto('/app/items/new');
  await page.getByLabel(/Item name/).fill('Invalid');
  await page.getByLabel(/Unit price/).fill('12.345');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByText('Too many decimal places for INR')).toBeVisible();

  // Totals: 12,999.50 × 2 + 1,499 = 27,498.00
  await page.goto('/app');
  const totalTile = page.getByRole('region', { name: 'Key figures' });
  await expect(totalTile.getByText('₹27,498.00')).toBeVisible();
  await expect(totalTile.getByText('Air purifier')).toBeVisible(); // highest-priced item

  // Search and edit.
  await page.goto('/app/records');
  await page.getByRole('searchbox', { name: 'Search records', exact: true }).fill('AP-77');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Air purifier' }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel(/Unit price/).fill('11,999.50');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: '−₹1,000.00' })).toBeVisible();

  // Trash and undo.
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to trash' }).click();
  await expect(page).toHaveURL(/\/app\/records$/);
  await expect(page.getByRole('link', { name: 'Air purifier' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: 'Air purifier' })).toBeVisible();

  // Sign out: protected pages redirect to sign-in and remember the destination.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/app/analytics');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fanalytics/);
});

test("one user cannot open another user's record", async ({ browser }) => {
  const ownerPage = await (await browser.newContext()).newPage();
  await registerAndSignIn(ownerPage, uniqueEmail('alice'), 'Alice');
  await ownerPage.goto('/app/items/new');
  await ownerPage.getByLabel(/Item name/).fill('Private watch');
  await ownerPage.getByLabel(/Unit price/).fill('250000');
  await ownerPage.getByRole('button', { name: 'Save item' }).click();
  await expect(ownerPage).toHaveURL(/\/app\/records\/[0-9a-f-]{36}$/);
  const privateUrl = new URL(ownerPage.url()).pathname;

  const intruderPage = await (await browser.newContext()).newPage();
  await registerAndSignIn(intruderPage, uniqueEmail('mallory'), 'Mallory');
  await intruderPage.goto(privateUrl);
  await expect(intruderPage.getByText('Record not found')).toBeVisible();
  await expect(intruderPage.getByText('Private watch')).toHaveCount(0);
});

test('sign-in errors do not reveal whether an account exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(uniqueEmail('nobody'));
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Incorrect sign-in details/)).toBeVisible();
});
