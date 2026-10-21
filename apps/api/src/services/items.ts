import { LedgerKind, Prisma } from '@prisma/client';
import {
  parseMoney,
  type BulkActionInput,
  type CreateItemData,
  type CurrencyCode,
  type itemListQuerySchema,
} from '@vaultledger/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { prisma } from '../db';
import { AppError, notFound } from '../lib/errors';
import { categorySelect, type ItemWithCategory } from '../lib/serialize';
import { dateRangeToInstants, resolveTimeZone } from '../lib/time';
import { logActivity } from './activity';

type Tx = Prisma.TransactionClient;
export type ParsedListQuery = z.output<typeof itemListQuerySchema>;

function toMinor(price: string, currency: CurrencyCode): bigint {
  const parsed = parseMoney(price, currency);
  if (!parsed.ok) throw new AppError('VALIDATION_FAILED', 'Invalid price', { price: 'Enter a valid, non-negative amount' });
  return parsed.minor;
}

function lineValue(priceMinor: bigint, quantity: number): Prisma.Decimal {
  return new Prisma.Decimal((priceMinor * BigInt(quantity)).toString());
}

/** Escapes LIKE wildcards so user input is matched literally. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function assertCategoryOwned(tx: Tx, userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await tx.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
  if (!category) throw new AppError('VALIDATION_FAILED', 'Unknown category', { categoryId: 'Choose one of your categories' });
}

/** Builds the owner-scoped filter for list, export and bulk operations. */
export function buildItemWhere(userId: string, query: ParsedListQuery): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = {
    userId,
    deletedAt: query.status === 'deleted' ? { not: null } : null,
  };
  const and: Prisma.ItemWhereInput[] = [];

  if (query.q) {
    const term = likeLiteral(query.q);
    and.push({
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { supplier: { contains: term, mode: 'insensitive' } },
        { tags: { has: query.q.toLowerCase() } },
      ],
    });
  }
  if (query.categoryId === 'none') where.categoryId = null;
  else if (query.categoryId) where.categoryId = query.categoryId;
  if (query.tag) where.tags = { has: query.tag };
  if (query.currency) {
    where.currency = query.currency;
    const price: Prisma.BigIntFilter = {};
    if (query.minPrice) price.gte = toMinor(query.minPrice, query.currency);
    if (query.maxPrice) price.lte = toMinor(query.maxPrice, query.currency);
    if (price.gte !== undefined || price.lte !== undefined) where.priceMinor = price;
  }
  if (query.from || query.to) {
    const range = dateRangeToInstants(query.from, query.to, resolveTimeZone(query.tz));
    where.createdAt = { ...(range.gte ? { gte: range.gte } : {}), ...(range.lt ? { lt: range.lt } : {}) };
  }
  if (and.length) where.AND = and;
  return where;
}

export function buildItemOrder(query: Pick<ParsedListQuery, 'sort' | 'order'>): Prisma.ItemOrderByWithRelationInput[] {
  const direction = query.order ?? 'desc';
  const field = query.sort ?? 'createdAt';
  const primary: Prisma.ItemOrderByWithRelationInput =
    field === 'price' ? { priceMinor: direction } : field === 'name' ? { name: direction } : { [field]: direction };
  // A unique tie-breaker keeps pagination stable.
  return [primary, { id: direction }];
}

export async function listItems(userId: string, query: ParsedListQuery) {
  const where = buildItemWhere(userId, query);
  const [items, total] = await prisma.$transaction([
    prisma.item.findMany({
      where,
      include: { category: categorySelect },
      orderBy: buildItemOrder(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.item.count({ where }),
  ]);
  return { items, total };
}

export async function getItem(userId: string, id: string) {
  const item = await prisma.item.findFirst({
    where: { id, userId },
    include: { category: categorySelect, priceHistory: { orderBy: { recordedAt: 'desc' }, take: 50 } },
  });
  if (!item) throw notFound('Item');
  return item;
}

/**
 * Creates an item together with its first price-history entry and value-ledger
 * entry. Repeating a request with the same idempotency key returns the
 * original item instead of creating a duplicate.
 */
export async function createItem(
  userId: string,
  data: CreateItemData,
  idempotencyKey: string | null,
  req: Request,
): Promise<{ item: ItemWithCategory; replayed: boolean }> {
  if (idempotencyKey) {
    const existing = await prisma.item.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId: idempotencyKey } },
      include: { category: categorySelect },
    });
    if (existing) return { item: existing, replayed: true };
  }

  const priceMinor = toMinor(data.price, data.currency);
  try {
    const item = await prisma.$transaction(async (tx) => {
      await assertCategoryOwned(tx, userId, data.categoryId);
      const created = await tx.item.create({
        data: {
          userId,
          name: data.name,
          priceMinor,
          currency: data.currency,
          quantity: data.quantity,
          categoryId: data.categoryId,
          sku: data.sku,
          description: data.description,
          supplier: data.supplier,
          purchaseDate: data.purchaseDate ? new Date(`${data.purchaseDate}T00:00:00Z`) : null,
          tags: data.tags,
          clientRequestId: idempotencyKey,
        },
        include: { category: categorySelect },
      });
      await tx.priceHistory.create({
        data: { itemId: created.id, userId, priceMinor, currency: data.currency, quantity: data.quantity, recordedAt: created.createdAt },
      });
      await tx.valueLedgerEntry.create({
        data: {
          userId,
          itemId: created.id,
          currency: data.currency,
          deltaMinor: lineValue(priceMinor, data.quantity),
          kind: LedgerKind.ADD,
          occurredAt: created.createdAt,
        },
      });
      await logActivity({ userId, type: 'item.created', summary: `Added "${created.name}"`, entityId: created.id }, req, tx);
      return created;
    });
    return { item, replayed: false };
  } catch (error) {
    // Two identical requests raced: return the one that won.
    if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.item.findUnique({
        where: { userId_clientRequestId: { userId, clientRequestId: idempotencyKey } },
        include: { category: categorySelect },
      });
      if (existing) return { item: existing, replayed: true };
    }
    throw error;
  }
}

export interface UpdateItemData {
  name?: string;
  price?: string;
  currency?: CurrencyCode;
  quantity?: number;
  categoryId?: string | null;
  sku?: string | null;
  description?: string | null;
  supplier?: string | null;
  purchaseDate?: string | null;
  tags?: string[];
  version: number;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  priceMinor: 'price',
  currency: 'currency',
  quantity: 'quantity',
  categoryId: 'category',
  sku: 'SKU',
  description: 'description',
  supplier: 'supplier',
  purchaseDate: 'purchase date',
  tags: 'tags',
};

export async function updateItem(userId: string, id: string, input: UpdateItemData, req: Request) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.item.findFirst({ where: { id, userId, deletedAt: null } });
    if (!current) throw notFound('Item');
    if (current.version !== input.version) {
      throw new AppError('VERSION_CONFLICT', 'This item was changed on another device. Reload it to see the latest version.');
    }

    const currency = (input.currency ?? current.currency) as CurrencyCode;
    let priceMinor = current.priceMinor;
    if (input.price !== undefined) priceMinor = toMinor(input.price, currency);
    else if (currency !== current.currency) {
      // Minor units differ between currencies, so the price must be re-entered.
      throw new AppError('VALIDATION_FAILED', 'Enter the price in the new currency', { price: 'Enter the price in the new currency' });
    }
    const quantity = input.quantity ?? current.quantity;
    if (input.categoryId !== undefined) await assertCategoryOwned(tx, userId, input.categoryId);

    const data: Prisma.ItemUncheckedUpdateManyInput = {};
    if (input.name !== undefined && input.name !== current.name) data.name = input.name;
    if (priceMinor !== current.priceMinor) data.priceMinor = priceMinor;
    if (currency !== current.currency) data.currency = currency;
    if (quantity !== current.quantity) data.quantity = quantity;
    if (input.categoryId !== undefined && input.categoryId !== current.categoryId) data.categoryId = input.categoryId;
    if (input.sku !== undefined && input.sku !== current.sku) data.sku = input.sku;
    if (input.description !== undefined && input.description !== current.description) data.description = input.description;
    if (input.supplier !== undefined && input.supplier !== current.supplier) data.supplier = input.supplier;
    if (input.purchaseDate !== undefined) {
      const next = input.purchaseDate ? new Date(`${input.purchaseDate}T00:00:00Z`) : null;
      if (next?.getTime() !== current.purchaseDate?.getTime()) data.purchaseDate = next;
    }
    if (input.tags !== undefined && input.tags.join('\u0000') !== current.tags.join('\u0000')) data.tags = input.tags;

    const changed = Object.keys(data);
    if (changed.length === 0) {
      return tx.item.findFirstOrThrow({ where: { id, userId }, include: { category: categorySelect } });
    }

    const { count } = await tx.item.updateMany({
      where: { id, userId, version: current.version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    if (count !== 1) {
      throw new AppError('VERSION_CONFLICT', 'This item was changed on another device. Reload it to see the latest version.');
    }

    const valueChanged = 'priceMinor' in data || 'currency' in data || 'quantity' in data;
    if (valueChanged) {
      const now = new Date();
      await tx.priceHistory.create({ data: { itemId: id, userId, priceMinor, currency, quantity, recordedAt: now } });
      const before = lineValue(current.priceMinor, current.quantity);
      const after = lineValue(priceMinor, quantity);
      if (currency === current.currency) {
        if (!before.equals(after)) {
          await tx.valueLedgerEntry.create({
            data: { userId, itemId: id, currency, deltaMinor: after.minus(before), kind: LedgerKind.REPRICE, occurredAt: now },
          });
        }
      } else {
        // A currency change moves the value from one currency's total to another's.
        await tx.valueLedgerEntry.createMany({
          data: [
            { userId, itemId: id, currency: current.currency, deltaMinor: before.negated(), kind: LedgerKind.REMOVE, occurredAt: now },
            { userId, itemId: id, currency, deltaMinor: after, kind: LedgerKind.ADD, occurredAt: now },
          ],
        });
      }
    }

    const updated = await tx.item.findFirstOrThrow({ where: { id, userId }, include: { category: categorySelect } });
    await logActivity(
      {
        userId,
        type: 'item.updated',
        summary: `Updated ${changed.map((key) => FIELD_LABELS[key] ?? key).join(', ')} of "${updated.name}"`,
        entityId: id,
        metadata: { fields: changed.map((key) => FIELD_LABELS[key] ?? key) },
      },
      req,
      tx,
    );
    return updated;
  });
}

/** Moves active items to the trash and records the drop in collection value. */
export async function softDeleteItems(userId: string, ids: string[], req: Request): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.item.findMany({ where: { id: { in: ids }, userId, deletedAt: null } });
    if (items.length === 0) return 0;
    const now = new Date();
    await tx.item.updateMany({
      where: { id: { in: items.map((item) => item.id) }, userId, deletedAt: null },
      data: { deletedAt: now, version: { increment: 1 } },
    });
    await tx.valueLedgerEntry.createMany({
      data: items.map((item) => ({
        userId,
        itemId: item.id,
        currency: item.currency,
        deltaMinor: lineValue(item.priceMinor, item.quantity).negated(),
        kind: LedgerKind.REMOVE,
        occurredAt: now,
      })),
    });
    await logActivity(
      {
        userId,
        type: 'item.deleted',
        summary: items.length === 1 ? `Moved "${items[0]!.name}" to trash` : `Moved ${items.length} items to trash`,
        entityId: items.length === 1 ? items[0]!.id : null,
        metadata: { count: items.length },
      },
      req,
      tx,
    );
    return items.length;
  });
}

export async function restoreItems(userId: string, ids: string[], req: Request): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.item.findMany({ where: { id: { in: ids }, userId, deletedAt: { not: null } } });
    if (items.length === 0) return 0;
    const now = new Date();
    await tx.item.updateMany({
      where: { id: { in: items.map((item) => item.id) }, userId },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    await tx.valueLedgerEntry.createMany({
      data: items.map((item) => ({
        userId,
        itemId: item.id,
        currency: item.currency,
        deltaMinor: lineValue(item.priceMinor, item.quantity),
        kind: LedgerKind.ADD,
        occurredAt: now,
      })),
    });
    await logActivity(
      {
        userId,
        type: 'item.restored',
        summary: items.length === 1 ? `Restored "${items[0]!.name}"` : `Restored ${items.length} items`,
        entityId: items.length === 1 ? items[0]!.id : null,
        metadata: { count: items.length },
      },
      req,
      tx,
    );
    return items.length;
  });
}

/** Permanently deletes items that are already in the trash. Ledger history is retained. */
export async function purgeItems(userId: string, ids: string[], req: Request): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.item.findMany({
      where: { id: { in: ids }, userId, deletedAt: { not: null } },
      select: { id: true, name: true },
    });
    if (items.length === 0) return 0;
    await tx.item.deleteMany({ where: { id: { in: items.map((item) => item.id) }, userId, deletedAt: { not: null } } });
    await logActivity(
      {
        userId,
        type: 'item.purged',
        summary: items.length === 1 ? `Permanently deleted "${items[0]!.name}"` : `Permanently deleted ${items.length} items`,
        metadata: { count: items.length },
      },
      req,
      tx,
    );
    return items.length;
  });
}

export async function setItemsCategory(userId: string, ids: string[], categoryId: string | null, req: Request): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await assertCategoryOwned(tx, userId, categoryId);
    const { count } = await tx.item.updateMany({
      where: { id: { in: ids }, userId, deletedAt: null },
      data: { categoryId, version: { increment: 1 } },
    });
    if (count > 0) {
      await logActivity(
        { userId, type: 'item.updated', summary: `Changed the category of ${count} item(s)`, metadata: { count, fields: ['category'] } },
        req,
        tx,
      );
    }
    return count;
  });
}

export async function runBulkAction(userId: string, input: BulkActionInput, req: Request): Promise<number> {
  const ids = Array.from(new Set(input.ids));
  switch (input.action) {
    case 'delete':
      return softDeleteItems(userId, ids, req);
    case 'restore':
      return restoreItems(userId, ids, req);
    case 'purge':
      return purgeItems(userId, ids, req);
    case 'setCategory':
      return setItemsCategory(userId, ids, input.categoryId, req);
  }
}

