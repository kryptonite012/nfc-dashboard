import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { logger } from './logger';
import { waitForDeliveries } from './services/delivery';
import { verifyMailTransport } from './services/mailer';
import { purgeExpiredSessions } from './services/sessions';

const app = createApp();
const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      email: config.EMAIL_TRANSPORT,
      sms: config.SMS_PROVIDER,
      servesWeb: Boolean(config.WEB_DIST_DIR),
    },
    'VaultLedger API listening',
  );
  if (config.EMAIL_TRANSPORT === 'outbox') {
    logger.warn(`Emails are NOT delivered: they are written to ${config.MAIL_OUTBOX_DIR}/ (development only).`);
  }
  if (config.SMS_PROVIDER === 'outbox') {
    logger.warn(`SMS messages are NOT delivered: they are written to ${config.SMS_OUTBOX_DIR}/ (development only).`);
  }
});

verifyMailTransport().catch((error: unknown) => {
  logger.error({ err: error instanceof Error ? error.message : 'unknown' }, 'SMTP connection check failed; emails may not be delivered');
});

const cleanup = setInterval(() => {
  purgeExpiredSessions()
    .then((count) => count && logger.info({ count }, 'Expired sessions removed'))
    .catch((error: unknown) => logger.error({ err: error instanceof Error ? error.message : 'unknown' }, 'Session cleanup failed'));
}, 60 * 60_000);
cleanup.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  server.close();
  await waitForDeliveries();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
