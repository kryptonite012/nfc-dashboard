import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { deliverInBackground, writeToOutbox } from './delivery';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    requireTLS: !config.SMTP_SECURE && config.isProduction,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transporter;
}

async function send(message: EmailMessage): Promise<void> {
  if (config.EMAIL_TRANSPORT === 'smtp') {
    await getTransporter().sendMail({ from: config.EMAIL_FROM, ...message });
    return;
  }
  await writeToOutbox(config.isTest ? null : config.MAIL_OUTBOX_DIR, {
    channel: 'email',
    to: message.to,
    subject: message.subject,
    text: message.text,
    sentAt: new Date(),
  });
}

/** Queues an email for background delivery. */
export function sendEmail(message: EmailMessage): void {
  deliverInBackground('email', () => send(message));
}

export async function verifyMailTransport(): Promise<void> {
  if (config.EMAIL_TRANSPORT === 'smtp') await getTransporter().verify();
}
