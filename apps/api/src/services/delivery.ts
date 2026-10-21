import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger';

/**
 * Outbound messages (email / SMS) are delivered in the background so that
 * response times do not reveal whether an account exists. Pending deliveries
 * are tracked so tests and graceful shutdown can wait for them.
 */
const pending = new Set<Promise<unknown>>();

export function deliverInBackground(label: string, task: () => Promise<void>): void {
  const promise = task()
    .catch((error: unknown) => {
      logger.error({ err: error instanceof Error ? error.message : 'unknown', label }, 'Message delivery failed');
    })
    .finally(() => pending.delete(promise));
  pending.add(promise);
}

export async function waitForDeliveries(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

/** Development/test outbox. Messages are written to files and kept in memory, never logged. */
export interface OutboxMessage {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  text: string;
  sentAt: Date;
}

const memoryOutbox: OutboxMessage[] = [];
const MEMORY_OUTBOX_LIMIT = 200;

export function getOutbox(): readonly OutboxMessage[] {
  return memoryOutbox;
}

export function clearOutbox(): void {
  memoryOutbox.length = 0;
}

export async function writeToOutbox(directory: string | null, message: OutboxMessage): Promise<void> {
  memoryOutbox.push(message);
  if (memoryOutbox.length > MEMORY_OUTBOX_LIMIT) memoryOutbox.shift();
  if (!directory) return;

  const dir = path.resolve(process.cwd(), directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const safeRecipient = message.to.replace(/[^a-zA-Z0-9@.+-]/g, '_');
  const fileName = `${message.sentAt.toISOString().replace(/[:.]/g, '-')}-${message.channel}-${safeRecipient}.txt`;
  const content = [
    `Channel: ${message.channel}`,
    `To: ${message.to}`,
    message.subject ? `Subject: ${message.subject}` : null,
    `Date: ${message.sentAt.toISOString()}`,
    '',
    message.text,
  ]
    .filter((line) => line !== null)
    .join('\n');
  await writeFile(path.join(dir, fileName), content, { mode: 0o600 });
  logger.info({ channel: message.channel, file: fileName }, 'Development outbox: message written (not delivered)');
}
