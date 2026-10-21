import type { Response } from 'express';
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import {
  currencyExponent,
  minorToDecimalString,
  type CurrencyCode,
  type OverviewDTO,
  type SupportedLocale,
} from '@vaultledger/shared';
import { prisma } from '../db';
import { csvRow } from '../lib/csv';
import { asCurrency, categorySelect, dateOnly } from '../lib/serialize';
import { buildItemOrder, buildItemWhere, type ParsedListQuery } from './items';

export const CSV_EXPORT_LIMIT = 50_000;
export const PDF_EXPORT_LIMIT = 2_000;
const BATCH = 1_000;

const CSV_HEADER = [
  'Name',
  'Unit price',
  'Currency',
  'Quantity',
  'Line total',
  'Category',
  'SKU',
  'Description',
  'Supplier',
  'Purchase date',
  'Tags',
  'Created at (UTC)',
  'Updated at (UTC)',
];

/** Streams the user's filtered records as CSV in batches using keyset-free offset paging. */
export async function streamCsv(res: Response, userId: string, query: ParsedListQuery): Promise<number> {
  const where = buildItemWhere(userId, query);
  const orderBy = buildItemOrder(query);
  res.write('﻿'); // BOM so spreadsheet apps detect UTF-8
  res.write(csvRow(CSV_HEADER));

  let written = 0;
  while (written < CSV_EXPORT_LIMIT) {
    const batch = await prisma.item.findMany({
      where,
      orderBy,
      include: { category: categorySelect },
      skip: written,
      take: Math.min(BATCH, CSV_EXPORT_LIMIT - written),
    });
    for (const item of batch) {
      const currency = asCurrency(item.currency);
      res.write(
        csvRow([
          item.name,
          minorToDecimalString(item.priceMinor, currency),
          currency,
          item.quantity,
          minorToDecimalString(item.priceMinor * BigInt(item.quantity), currency),
          item.category?.name ?? '',
          item.sku,
          item.description,
          item.supplier,
          dateOnly(item.purchaseDate),
          item.tags.join('; '),
          item.createdAt.toISOString(),
          item.updatedAt.toISOString(),
        ]),
      );
    }
    written += batch.length;
    if (batch.length < BATCH) break;
  }
  res.end();
  return written;
}

const UNICODE_FONT_CANDIDATES = [
  process.env.PDF_FONT_PATH,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
].filter((value): value is string => Boolean(value));

const unicodeFont = UNICODE_FONT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;

function formatAmount(decimal: string, currency: CurrencyCode, locale: SupportedLocale): string {
  const digits = currencyExponent(currency);
  const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    decimal as unknown as number,
  );
  return `${currency} ${formatted}`;
}

/** Built-in PDF fonts only cover Latin-1; replace anything else when no Unicode font is installed. */
function pdfText(value: string): string {
  return unicodeFont ? value : value.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export async function streamPdf(
  res: Response,
  userId: string,
  query: ParsedListQuery,
  context: { userName: string; locale: SupportedLocale; overview: OverviewDTO; filtersSummary: string },
): Promise<number> {
  const items = await prisma.item.findMany({
    where: buildItemWhere(userId, query),
    orderBy: buildItemOrder(query),
    include: { category: categorySelect },
    take: PDF_EXPORT_LIMIT,
  });

  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'VaultLedger records', Author: 'VaultLedger' } });
  doc.pipe(res);
  if (unicodeFont) doc.registerFont('body', unicodeFont).font('body');
  else doc.font('Helvetica');

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.fontSize(18).fillColor('#1e3a8a').text('VaultLedger — Records report');
  doc.moveDown(0.3);
  doc
    .fontSize(9)
    .fillColor('#475569')
    .text(pdfText(`Prepared for ${context.userName} on ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`));
  doc.text(pdfText(`Filters: ${context.filtersSummary}`));
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#0f172a').text('Totals for active records (unit price × quantity)');
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#334155');
  if (context.overview.currencies.length === 0) doc.text('No active records.');
  for (const summary of context.overview.currencies) {
    doc.text(
      `${summary.currency}: ${summary.itemCount} record(s), total ${formatAmount(summary.totalValue, summary.currency, context.locale)}, ` +
        `average unit price ${formatAmount(summary.averagePrice, summary.currency, context.locale)}`,
    );
  }
  doc.moveDown(0.8);

  const columns = [
    { label: 'Item', width: 0.3 },
    { label: 'Category', width: 0.15 },
    { label: 'Qty', width: 0.07, align: 'right' as const },
    { label: 'Unit price', width: 0.17, align: 'right' as const },
    { label: 'Line total', width: 0.17, align: 'right' as const },
    { label: 'Added', width: 0.14, align: 'right' as const },
  ];
  const drawRow = (cells: string[], header = false) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
    const y = doc.y;
    let x = doc.page.margins.left;
    doc.fontSize(8.5).fillColor(header ? '#1e3a8a' : '#0f172a');
    cells.forEach((cell, index) => {
      const column = columns[index]!;
      const width = column.width * pageWidth;
      doc.text(pdfText(cell), x + 2, y, { width: width - 4, align: column.align ?? 'left', lineBreak: false, ellipsis: true });
      x += width;
    });
    doc.moveDown(0.25);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + pageWidth, doc.y)
      .strokeColor(header ? '#94a3b8' : '#e2e8f0')
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.25);
  };

  drawRow(columns.map((column) => column.label), true);
  for (const item of items) {
    const currency = asCurrency(item.currency);
    drawRow([
      truncate(item.name, 60),
      truncate(item.category?.name ?? '—', 30),
      item.quantity.toLocaleString(context.locale),
      formatAmount(minorToDecimalString(item.priceMinor, currency), currency, context.locale),
      formatAmount(minorToDecimalString(item.priceMinor * BigInt(item.quantity), currency), currency, context.locale),
      item.createdAt.toISOString().slice(0, 10),
    ]);
  }
  if (items.length === PDF_EXPORT_LIMIT) {
    doc.moveDown(0.5).fontSize(8).fillColor('#b45309').text(`Only the first ${PDF_EXPORT_LIMIT} records are included. Use CSV export for the full list.`);
  }
  doc.end();
  return items.length;
}
