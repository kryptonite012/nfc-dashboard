import type { Prisma, PrismaClient } from '@prisma/client';
import type { ActivityType } from '@vaultledger/shared';
import type { Request } from 'express';
import { prisma } from '../db';
import { clientIp, userAgent } from '../lib/http';

type Db = PrismaClient | Prisma.TransactionClient;

export interface ActivityEntry {
  userId: string;
  type: ActivityType;
  summary: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Appends to the user's activity history. Never include secrets in `summary` or `metadata`. */
export async function logActivity(entry: ActivityEntry, req?: Request, db: Db = prisma): Promise<void> {
  await db.activityLog.create({
    data: {
      userId: entry.userId,
      type: entry.type,
      summary: entry.summary.slice(0, 300),
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ipAddress: req ? clientIp(req) : null,
      userAgent: req ? userAgent(req) : null,
    },
  });
}

export async function notify(
  userId: string,
  notification: { kind: 'security' | 'data' | 'account'; title: string; body: string; link?: string },
  db: Db = prisma,
): Promise<void> {
  await db.notification.create({
    data: {
      userId,
      kind: notification.kind,
      title: notification.title.slice(0, 120),
      body: notification.body.slice(0, 500),
      link: notification.link ?? null,
    },
  });
}
