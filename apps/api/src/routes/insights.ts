import {
  ACTIVITY_TYPES,
  activityQuerySchema,
  analyticsQuerySchema,
  markNotificationsSchema,
  notificationsQuerySchema,
  type ActivityDTO,
  type ActivityType,
  type NotificationDTO,
} from '@vaultledger/shared';
import { Router } from 'express';
import { prisma } from '../db';
import { parseBody, parseQuery, sendData } from '../lib/http';
import { asCurrency } from '../lib/serialize';
import { auth, requireAuth } from '../middleware/auth';
import { getAnalytics, getOverview } from '../services/analytics';

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

insightsRouter.get('/overview', async (req, res) => {
  const { user } = auth(req);
  res.setHeader('Cache-Control', 'no-store');
  sendData(res, await getOverview(user.id, asCurrency(user.defaultCurrency)));
});

insightsRouter.get('/analytics', async (req, res) => {
  const { user } = auth(req);
  const query = parseQuery(analyticsQuerySchema, req);
  res.setHeader('Cache-Control', 'no-store');
  sendData(res, await getAnalytics(user.id, asCurrency(user.defaultCurrency), query));
});

const SCOPE_TYPES: Record<'items' | 'security' | 'data', ActivityType[]> = {
  items: ACTIVITY_TYPES.filter((type) => type.startsWith('item.') || type.startsWith('category.')),
  security: ACTIVITY_TYPES.filter((type) => type.startsWith('auth.') || type.startsWith('account.')),
  data: ACTIVITY_TYPES.filter((type) => type.startsWith('data.')),
};

insightsRouter.get('/activity', async (req, res) => {
  const { user } = auth(req);
  const query = parseQuery(activityQuerySchema, req);
  const where = { userId: user.id, ...(query.scope === 'all' ? {} : { type: { in: SCOPE_TYPES[query.scope] } }) };
  const [entries, total] = await prisma.$transaction([
    prisma.activityLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.activityLog.count({ where }),
  ]);
  const data: ActivityDTO[] = entries.map((entry) => ({
    id: entry.id,
    type: entry.type as ActivityType,
    summary: entry.summary,
    entityId: entry.entityId,
    ipAddress: entry.ipAddress,
    createdAt: entry.createdAt.toISOString(),
  }));
  sendData(res, data, 200, {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  });
});

insightsRouter.get('/notifications', async (req, res) => {
  const { user } = auth(req);
  const query = parseQuery(notificationsQuerySchema, req);
  const [entries, unread] = await prisma.$transaction([
    prisma.notification.findMany({
      where: { userId: user.id, ...(query.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  const data: NotificationDTO[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind as NotificationDTO['kind'],
    title: entry.title,
    body: entry.body,
    link: entry.link,
    readAt: entry.readAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
  }));
  res.setHeader('Cache-Control', 'no-store');
  sendData(res, data, 200, { unread });
});

insightsRouter.post('/notifications/read', async (req, res) => {
  const { user } = auth(req);
  const input = parseBody(markNotificationsSchema, req);
  const { count } = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(input.all ? {} : { id: { in: input.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  sendData(res, { updated: count });
});
