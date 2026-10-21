import { importSchema, itemListQuerySchema } from '@vaultledger/shared';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { parseBody, parseQuery, sendData } from '../lib/http';
import { asCurrency, dateOnly, toItemDTO, toPriceHistoryDTO, toUserDTO } from '../lib/serialize';
import { auth, requireAuth } from '../middleware/auth';
import { rateLimits } from '../middleware/rate-limit';
import { logActivity } from '../services/activity';
import { getOverview } from '../services/analytics';
import { streamCsv, streamPdf } from '../services/export';
import { importCsv } from '../services/import';

export const dataRouter = Router();
dataRouter.use(requireAuth);

const exportQuerySchema = itemListQuerySchema.safeExtend({ format: z.enum(['csv', 'pdf']).default('csv') });

function describeFilters(query: z.output<typeof exportQuerySchema>): string {
  const parts: string[] = [query.status === 'deleted' ? 'Trash' : 'Active records'];
  if (query.q) parts.push(`search "${query.q}"`);
  if (query.categoryId) parts.push(query.categoryId === 'none' ? 'uncategorised' : 'one category');
  if (query.currency) parts.push(`currency ${query.currency}`);
  if (query.minPrice) parts.push(`min ${query.minPrice}`);
  if (query.maxPrice) parts.push(`max ${query.maxPrice}`);
  if (query.from || query.to) parts.push(`added ${query.from ?? '…'} to ${query.to ?? '…'}`);
  if (query.tag) parts.push(`tag "${query.tag}"`);
  return parts.join(', ');
}

dataRouter.get('/export', rateLimits.export, async (req, res) => {
  const { user } = auth(req);
  const query = parseQuery(exportQuerySchema, req);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Cache-Control', 'no-store');

  let count: number;
  if (query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vaultledger-records-${stamp}.pdf"`);
    const overview = await getOverview(user.id, asCurrency(user.defaultCurrency));
    count = await streamPdf(res, user.id, query, {
      userName: user.name,
      locale: user.locale as Parameters<typeof streamPdf>[3]['locale'],
      overview,
      filtersSummary: describeFilters(query),
    });
  } else {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vaultledger-records-${stamp}.csv"`);
    count = await streamCsv(res, user.id, query);
  }
  await logActivity(
    { userId: user.id, type: 'data.exported', summary: `Exported ${count} record(s) as ${query.format.toUpperCase()}`, metadata: { count, format: query.format } },
    req,
  );
});

dataRouter.post('/import', rateLimits.import, async (req, res) => {
  const { user } = auth(req);
  const input = parseBody(importSchema, req);
  sendData(res, await importCsv(user.id, input, req));
});

/** Machine-readable copy of everything stored about the user (data portability). */
dataRouter.get('/account-export', rateLimits.export, async (req, res) => {
  const { user } = auth(req);
  const [categories, items, activity] = await Promise.all([
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }),
    prisma.item.findMany({
      where: { userId: user.id },
      include: { category: { select: { id: true, name: true, color: true } }, priceHistory: { orderBy: { recordedAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.activityLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5000 }),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    account: toUserDTO(user),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      createdAt: category.createdAt.toISOString(),
    })),
    items: items.map((item) => ({ ...toItemDTO(item), priceHistory: item.priceHistory.map(toPriceHistoryDTO) })),
    activity: activity.map((entry) => ({
      type: entry.type,
      summary: entry.summary,
      ipAddress: entry.ipAddress,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
  await logActivity({ userId: user.id, type: 'data.exported', summary: 'Downloaded a full account data export' }, req);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="vaultledger-account-${dateOnly(new Date())}.json"`);
  res.json(payload);
});
