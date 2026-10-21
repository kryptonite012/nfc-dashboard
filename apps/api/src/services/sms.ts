import { config } from '../config';
import { AppError } from '../lib/errors';
import { deliverInBackground, writeToOutbox } from './delivery';

export function smsEnabled(): boolean {
  return config.SMS_PROVIDER !== 'disabled';
}

export function assertSmsEnabled(): void {
  if (!smsEnabled()) {
    throw new AppError('FEATURE_DISABLED', 'Phone verification is not available because no SMS provider is configured.');
  }
}

async function sendViaTwilio(to: string, body: string): Promise<void> {
  const sid = config.TWILIO_ACCOUNT_SID!;
  const form = new URLSearchParams({ To: to, Body: body });
  if (config.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', config.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', config.TWILIO_FROM_NUMBER!);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${config.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Twilio responded with HTTP ${response.status}`);
}

/** Queues an SMS for background delivery through the configured provider. */
export function sendSms(to: string, body: string): void {
  assertSmsEnabled();
  deliverInBackground('sms', async () => {
    if (config.SMS_PROVIDER === 'twilio') {
      await sendViaTwilio(to, body);
      return;
    }
    await writeToOutbox(config.isTest ? null : config.SMS_OUTBOX_DIR, { channel: 'sms', to, text: body, sentAt: new Date() });
  });
}
