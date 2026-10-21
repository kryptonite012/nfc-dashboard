/**
 * Development-only demo data. Creates (or recreates) one verified demo account
 * with a realistic history so the dashboard and analytics have something to show.
 *
 *   SEED_DEMO_PASSWORD='your own strong passphrase' npm run db:seed
 *
 * Refuses to run in production and never ships a default password.
 */
import { LedgerKind, Prisma, PrismaClient } from '@prisma/client';
import { parseMoney, type CurrencyCode } from '@vaultledger/shared';
import { assertStrongPassword, hashPassword } from '../src/lib/password';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const email = (process.env.SEED_DEMO_EMAIL ?? 'demo@vaultledger.local').toLowerCase();
const password = process.env.SEED_DEMO_PASSWORD;
if (!password) {
  console.error('Set SEED_DEMO_PASSWORD to the password you want for the demo account.');
  process.exit(1);
}

const prisma = new PrismaClient();
const DAY = 86_400_000;

const CATEGORIES = [
  { name: 'Electronics', color: 'blue' },
  { name: 'Home office', color: 'violet' },
  { name: 'Kitchen', color: 'amber' },
  { name: 'Books', color: 'teal' },
  { name: 'Travel', color: 'rose' },
] as const;

const ITEMS: { name: string; price: string; currency?: CurrencyCode; qty?: number; category: string; daysAgo: number; reprice?: string; delete?: boolean; tags?: string[] }[] = [
  { name: 'Laptop 14"', price: '124990', category: 'Electronics', daysAgo: 118, reprice: '119990', tags: ['work'] },
  { name: 'Noise-cancelling headphones', price: '29990', category: 'Electronics', daysAgo: 110 },
  { name: 'Mechanical keyboard', price: '8499', category: 'Home office', daysAgo: 104, tags: ['work'] },
  { name: 'Ergonomic chair', price: '21999', category: 'Home office', daysAgo: 96 },
  { name: 'Standing desk', price: '32500', category: 'Home office', daysAgo: 90, reprice: '29999' },
  { name: '27" monitor', price: '18990', qty: 2, category: 'Electronics', daysAgo: 84 },
  { name: 'Espresso machine', price: '45000', category: 'Kitchen', daysAgo: 77 },
  { name: 'Chef’s knife', price: '6200', category: 'Kitchen', daysAgo: 70 },
  { name: 'Cast-iron skillet', price: '3499', category: 'Kitchen', daysAgo: 64, delete: true },
  { name: 'Designing Data-Intensive Applications', price: '45.99', currency: 'USD', category: 'Books', daysAgo: 58 },
  { name: 'The Pragmatic Programmer', price: '39.95', currency: 'USD', category: 'Books', daysAgo: 52 },
  { name: 'Carry-on suitcase', price: '15999', category: 'Travel', daysAgo: 45 },
  { name: 'Travel adapter', price: '1299', qty: 3, category: 'Travel', daysAgo: 38 },
  { name: 'E-reader', price: '139.99', currency: 'USD', category: 'Electronics', daysAgo: 31, reprice: '129.99' },
  { name: 'USB-C dock', price: '11499', category: 'Home office', daysAgo: 24 },
  { name: 'Coffee grinder', price: '7999', category: 'Kitchen', daysAgo: 17 },
  { name: 'Webcam', price: '6499', category: 'Home office', daysAgo: 10, tags: ['work'] },
  { name: 'Portable SSD 1 TB', price: '8999', category: 'Electronics', daysAgo: 4 },
  { name: 'Desk plant', price: '799', category: 'Home office', daysAgo: 1 },
];

function minor(price: string, currency: CurrencyCode): bigint {
  const parsed = parseMoney(price, currency);
  if (!parsed.ok) throw new Error(`Bad seed price ${price}`);
  return parsed.minor;
}

async function main() {
  await assertStrongPassword(password!, [email]);
  await prisma.user.deleteMany({ where: { email } });

  const user = await prisma.user.create({
    data: {
      name: 'Demo User',
      email,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(password!),
      termsAcceptedAt: new Date(),
      createdAt: new Date(Date.now() - 120 * DAY),
    },
  });

  const categoryIds = new Map<string, string>();
  for (const category of CATEGORIES) {
    const created = await prisma.category.create({
      data: { userId: user.id, name: category.name, nameKey: category.name.toLowerCase(), color: category.color },
    });
    categoryIds.set(category.name, created.id);
  }

  for (const entry of ITEMS) {
    const currency = entry.currency ?? 'INR';
    const quantity = entry.qty ?? 1;
    const createdAt = new Date(Date.now() - entry.daysAgo * DAY);
    const priceMinor = minor(entry.price, currency);
    const item = await prisma.item.create({
      data: {
        userId: user.id,
        name: entry.name,
        priceMinor,
        currency,
        quantity,
        categoryId: categoryIds.get(entry.category) ?? null,
        tags: entry.tags ?? [],
        purchaseDate: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await prisma.priceHistory.create({ data: { itemId: item.id, userId: user.id, priceMinor, currency, quantity, recordedAt: createdAt } });
    await prisma.valueLedgerEntry.create({
      data: {
        userId: user.id,
        itemId: item.id,
        currency,
        deltaMinor: new Prisma.Decimal((priceMinor * BigInt(quantity)).toString()),
        kind: LedgerKind.ADD,
        occurredAt: createdAt,
      },
    });

    if (entry.reprice) {
      const at = new Date(createdAt.getTime() + Math.floor((entry.daysAgo * DAY) / 2));
      const next = minor(entry.reprice, currency);
      await prisma.item.update({ where: { id: item.id }, data: { priceMinor: next, version: 2, updatedAt: at } });
      await prisma.priceHistory.create({ data: { itemId: item.id, userId: user.id, priceMinor: next, currency, quantity, recordedAt: at } });
      await prisma.valueLedgerEntry.create({
        data: {
          userId: user.id,
          itemId: item.id,
          currency,
          deltaMinor: new Prisma.Decimal(((next - priceMinor) * BigInt(quantity)).toString()),
          kind: LedgerKind.REPRICE,
          occurredAt: at,
        },
      });
    }

    if (entry.delete) {
      const at = new Date(createdAt.getTime() + 20 * DAY);
      await prisma.item.update({ where: { id: item.id }, data: { deletedAt: at, version: { increment: 1 } } });
      await prisma.valueLedgerEntry.create({
        data: {
          userId: user.id,
          itemId: item.id,
          currency,
          deltaMinor: new Prisma.Decimal((-(priceMinor * BigInt(quantity))).toString()),
          kind: LedgerKind.REMOVE,
          occurredAt: at,
        },
      });
    }
  }

  console.warn(`Seeded ${ITEMS.length} items for ${email}. Sign in with the password from SEED_DEMO_PASSWORD.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
