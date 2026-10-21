import { PASSWORD_MIN_LENGTH, type PublicConfig } from '@vaultledger/shared';
import { Router } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { sendData } from '../lib/http';

export const systemRouter = Router();

/** Liveness: the process is up. */
systemRouter.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});

/** Readiness: the database is reachable. */
systemRouter.get('/ready', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

/** Feature flags the client needs to render the right forms. Contains no secrets. */
systemRouter.get('/config', (_req, res) => {
  const data: PublicConfig = {
    appName: config.APP_NAME,
    features: {
      phoneAuth: config.phoneAuthEnabled,
      emailDelivery: config.EMAIL_TRANSPORT,
      smsDelivery: config.SMS_PROVIDER,
      pdfExport: true,
      breachedPasswordCheck: config.HIBP_ENABLED,
    },
    requirePhoneOnSignup: config.REQUIRE_PHONE_ON_SIGNUP,
    passwordMinLength: PASSWORD_MIN_LENGTH,
  };
  res.setHeader('Cache-Control', 'public, max-age=300');
  sendData(res, data);
});
