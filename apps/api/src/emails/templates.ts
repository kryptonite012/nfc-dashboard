import { config } from '../config';
import type { EmailMessage } from '../services/mailer';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function appLink(pathname: string, params?: Record<string, string>): string {
  const url = new URL(pathname, config.APP_URL);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

interface Layout {
  to: string;
  subject: string;
  greeting: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

function render({ to, subject, greeting, paragraphs, action, footnote }: Layout): EmailMessage {
  const app = config.APP_NAME;
  const text = [
    greeting,
    '',
    ...paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(action ? [`${action.label}: ${action.url}`, ''] : []),
    ...(footnote ? [footnote, ''] : []),
    `— ${app}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
<tr><td style="padding:28px 32px 8px;font-weight:700;font-size:18px;color:#1e3a8a">${escapeHtml(app)}</td></tr>
<tr><td style="padding:8px 32px 24px;font-size:15px;line-height:1.6">
<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
${paragraphs.map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`).join('\n')}
${
  action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#475569">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : ''
}
${footnote ? `<p style="margin:16px 0 0;font-size:13px;color:#64748b">${escapeHtml(footnote)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;

  return { to, subject, text, html };
}

const IGNORE = 'If you did not request this, you can safely ignore this email.';

export const emails = {
  verifyEmail: (to: string, name: string, token: string) =>
    render({
      to,
      subject: `Verify your email for ${config.APP_NAME}`,
      greeting: `Hi ${name},`,
      paragraphs: ['Confirm your email address to finish creating your account. This link expires in 24 hours and can be used once.'],
      action: { label: 'Verify email address', url: appLink('/verify-email', { token }) },
      footnote: IGNORE,
    }),

  accountAlreadyExists: (to: string, name: string) =>
    render({
      to,
      subject: `Sign-up attempt for your ${config.APP_NAME} account`,
      greeting: `Hi ${name},`,
      paragraphs: [
        'Someone tried to create a new account with this email address, but you already have an account.',
        'If this was you, sign in instead or reset your password if you have forgotten it.',
      ],
      action: { label: 'Sign in', url: appLink('/login') },
      footnote: `Forgot your password? Reset it at ${appLink('/forgot-password')}. ${IGNORE}`,
    }),

  passwordReset: (to: string, name: string, token: string) =>
    render({
      to,
      subject: `Reset your ${config.APP_NAME} password`,
      greeting: `Hi ${name},`,
      paragraphs: [
        'We received a request to reset your password. This link expires in 30 minutes and can be used once.',
        'Resetting your password signs you out of every device.',
      ],
      action: { label: 'Choose a new password', url: appLink('/reset-password', { token }) },
      footnote: IGNORE,
    }),

  confirmEmailChange: (to: string, name: string, token: string) =>
    render({
      to,
      subject: `Confirm your new email address for ${config.APP_NAME}`,
      greeting: `Hi ${name},`,
      paragraphs: ['Confirm that you want to use this address to sign in. This link expires in 24 hours.'],
      action: { label: 'Confirm new email', url: appLink('/verify-email', { token, change: '1' }) },
      footnote: IGNORE,
    }),

  emailChangedNotice: (to: string, name: string, newEmail: string) =>
    render({
      to,
      subject: `Your ${config.APP_NAME} email address was changed`,
      greeting: `Hi ${name},`,
      paragraphs: [
        `The email address on your account was changed to ${newEmail}.`,
        'If you did not make this change, reset your password immediately and contact support.',
      ],
    }),

  passwordChangedNotice: (to: string, name: string) =>
    render({
      to,
      subject: `Your ${config.APP_NAME} password was changed`,
      greeting: `Hi ${name},`,
      paragraphs: [
        'The password for your account was just changed and other sessions were signed out.',
        'If you did not make this change, reset your password immediately.',
      ],
      action: { label: 'Reset password', url: appLink('/forgot-password') },
    }),

  accountDeleted: (to: string, name: string) =>
    render({
      to,
      subject: `Your ${config.APP_NAME} account was deleted`,
      greeting: `Hi ${name},`,
      paragraphs: [
        'Your account and all of its records were permanently deleted from our live database.',
        'Encrypted backups containing your data expire automatically according to the backup retention schedule described in the privacy policy.',
      ],
    }),
};
