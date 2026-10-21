import { LedgerKind, Prisma } from '@prisma/client';
import {
  categoryInputSchema,
  createItemSchema,
  IMPORT_MAX_ROWS,
  parseMoney,
  type CreateItemData,
  type CurrencyCode,
  type ImportResultDTO,
  type ImportRowResult,
} from '@vaultledger/shared';
import { parse } from 'csv-parse/sync';
import type { Request } from 'express';
import { prisma } from '../db';
import { AppError } from '../lib/errors';
import { logActivity, notify } from './activity';

type Field = 'name' | 'price' | 'currency' | 'quantity' | 'category' | 'sku' | 'description' | 'supplier' | 'purchaseDate' | 'tags';

const HEADER_ALIASES: Record<string, Field> = {
  name: 'name',
  item: 'name',
  'item name': 'name',
  title: 'name',
  price: 'price',
  'unit price': 'price',
  amount: 'price',
  cost: 'price',
  currency: 'currency',
  'currency code': 'currency',
  quantity: 'quantity',
  qty: 'quantity',
  category: 'category',
  sku: 'sku',
  reference: 'sku',
  'reference code': 'sku',
  ref: 'sku',
  description: 'description',
  notes: 'description',
  supplier: 'supplier',
  source: 'supplier',
  vendor: 'supplier',
  'purchase date': 'purchaseDate',
  purchased: 'purchaseDate',
  tags: 'tags',
};

const MAX_REPORTED_OK_ROWS = 50;
const MAX_REPORTED_ERROR_ROWS = 500;

function normalizeHeader(value: string): string {
  return value.replace(/^﻿/, '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

interface ParsedRow {
  row: number;
  data: CreateItemData;
  categoryName: string | null;
}

/** Validates an uploaded CSV and, when `commit` is true, imports every valid row in a single transaction. */
export async function importCsv(
  userId: string,
  input: { csv: string; commit: boolean; defaultCurrency: CurrencyCode; createMissingCategories: boolean },
  req: Request,
): Promise<ImportResultDTO> {
  let records: string[][];
  try {
    // Arrays (not column objects) are used so header names can never touch object prototypes.
    records = parse(input.csv, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      max_record_size: 20_000,
      to: IMPORT_MAX_ROWS + 2,
    }) as string[][];
  } catch {
    throw new AppError('VALIDATION_FAILED', 'The file could not be read as CSV.', { csv: 'The file could not be read as CSV' });
  }
  if (records.length < 2) {
    throw new AppError('VALIDATION_FAILED', 'The file needs a header row and at least one record.', { csv: 'No records found' });
  }

  if (records.length > IMPORT_MAX_ROWS + 1) {
    throw new AppError('VALIDATION_FAILED', `Import at most ${IMPORT_MAX_ROWS.toLocaleString('en-US')} rows per file.`, {
      csv: 'Too many rows',
    });
  }

  const header = records[0]!.map(normalizeHeader);
  const columnFor = new Map<Field, number>();
  header.forEach((name, index) => {
    const field = HEADER_ALIASES[name];
    if (field && !columnFor.has(field)) columnFor.set(field, index);
  });
  if (!columnFor.has('name') || !columnFor.has('price')) {
    throw new AppError('VALIDATION_FAILED', 'The header row must include "name" and "price" columns.', {
      csv: 'Missing "name" or "price" column',
    });
  }

  const existingCategories = await prisma.category.findMany({ where: { userId }, select: { id: true, nameKey: true, name: true } });
  const categoryByKey = new Map(existingCategories.map((category) => [category.nameKey, category]));
  const newCategoryNames = new Map<string, string>();

  const valid: ParsedRow[] = [];
  const results: ImportRowResult[] = [];
  let invalidCount = 0;
  let reportedOk = 0;

  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2; // 1-based, counting the header
    const cell = (field: Field) => {
      const column = columnFor.get(field);
      return column === undefined ? '' : (record[column] ?? '').trim();
    };
    const errors: string[] = [];

    const currencyText = cell('currency').toUpperCase() || input.defaultCurrency;
    const quantityText = cell('quantity');
    const quantity = quantityText === '' ? 1 : /^\d{1,7}$/.test(quantityText) ? Number(quantityText) : Number.NaN;
    const tags = cell('tags')
      .split(/[;|,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    // Tolerate a leading currency symbol such as ₹ or $; anything else (e.g. a minus sign) is validated as-is.
    const priceText = cell('price').replace(/^[₹$€£¥]\s*/u, '');

    const parsed = createItemSchema.safeParse({
      name: cell('name'),
      price: priceText,
      currency: currencyText,
      quantity,
      sku: cell('sku'),
      description: cell('description'),
      supplier: cell('supplier'),
      purchaseDate: cell('purchaseDate'),
      tags,
    });
    if (!parsed.success) {
      const seen = new Set<string>();
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.') || 'row';
        if (seen.has(field)) continue;
        seen.add(field);
        errors.push(`${field}: ${issue.message}`);
      }
    }

    let categoryName: string | null = null;
    const categoryText = cell('category');
    if (categoryText) {
      const category = categoryInputSchema.safeParse({ name: categoryText });
      if (!category.success) errors.push(`category: ${category.error.issues[0]?.message ?? 'Invalid category'}`);
      else {
        categoryName = category.data.name;
        const key = categoryName.toLowerCase();
        if (!categoryByKey.has(key)) {
          if (!input.createMissingCategories) errors.push(`category: "${categoryName}" does not exist`);
          else if (!newCategoryNames.has(key)) newCategoryNames.set(key, categoryName);
        }
      }
    }

    if (errors.length > 0 || !parsed.success) {
      invalidCount += 1;
      if (invalidCount <= MAX_REPORTED_ERROR_ROWS) {
        results.push({ row: rowNumber, status: 'error', errors, name: cell('name').slice(0, 120) || undefined });
      }
      return;
    }
    valid.push({ row: rowNumber, data: parsed.data, categoryName });
    if (reportedOk < MAX_REPORTED_OK_ROWS) {
      reportedOk += 1;
      results.push({ row: rowNumber, status: 'ok', name: parsed.data.name, price: parsed.data.price, currency: parsed.data.currency });
    }
  });

  const base: ImportResultDTO = {
    committed: false,
    totalRows: records.length - 1,
    validRows: valid.length,
    invalidRows: invalidCount,
    createdCount: 0,
    createdCategories: [...newCategoryNames.values()],
    rows: results.sort((a, b) => a.row - b.row),
  };
  if (!input.commit || valid.length === 0) return base;

  const createdCount = await prisma.$transaction(
    async (tx) => {
      if (newCategoryNames.size > 0) {
        await tx.category.createMany({
          data: [...newCategoryNames.entries()].map(([nameKey, name]) => ({ userId, name, nameKey, color: 'slate' })),
          skipDuplicates: true,
        });
      }
      const categories = await tx.category.findMany({ where: { userId }, select: { id: true, nameKey: true } });
      const categoryIdByKey = new Map(categories.map((category) => [category.nameKey, category.id]));
      const now = new Date();

      const created = await tx.item.createManyAndReturn({
        data: valid.map(({ data, categoryName }) => {
          const parsedPrice = parseMoney(data.price, data.currency);
          if (!parsedPrice.ok) throw new AppError('VALIDATION_FAILED', 'Invalid price in import');
          return {
            userId,
            name: data.name,
            priceMinor: parsedPrice.minor,
            currency: data.currency,
            quantity: data.quantity,
            categoryId: categoryName ? (categoryIdByKey.get(categoryName.toLowerCase()) ?? null) : null,
            sku: data.sku,
            description: data.description,
            supplier: data.supplier,
            purchaseDate: data.purchaseDate ? new Date(`${data.purchaseDate}T00:00:00Z`) : null,
            tags: data.tags,
            createdAt: now,
          };
        }),
        select: { id: true, priceMinor: true, currency: true, quantity: true },
      });

      await tx.priceHistory.createMany({
        data: created.map((item) => ({
          itemId: item.id,
          userId,
          priceMinor: item.priceMinor,
          currency: item.currency,
          quantity: item.quantity,
          recordedAt: now,
        })),
      });
      await tx.valueLedgerEntry.createMany({
        data: created.map((item) => ({
          userId,
          itemId: item.id,
          currency: item.currency,
          deltaMinor: new Prisma.Decimal((item.priceMinor * BigInt(item.quantity)).toString()),
          kind: LedgerKind.ADD,
          occurredAt: now,
        })),
      });
      await logActivity(
        {
          userId,
          type: 'data.imported',
          summary: `Imported ${created.length} item(s) from CSV${invalidCount ? `, skipped ${invalidCount} invalid row(s)` : ''}`,
          metadata: { created: created.length, skipped: invalidCount },
        },
        req,
        tx,
      );
      await notify(
        userId,
        {
          kind: 'data',
          title: 'Import complete',
          body: `${created.length} item(s) were imported${invalidCount ? ` and ${invalidCount} invalid row(s) were skipped` : ''}.`,
          link: '/app/records',
        },
        tx,
      );
      return created.length;
    },
    { timeout: 30_000 },
  );

  return { ...base, committed: true, createdCount };
}
