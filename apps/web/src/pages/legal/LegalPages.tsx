import { ArrowLeft } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Alert } from '@/components/ui/feedback';
import { IS_CLAUDE_EDITION } from '@/lib/edition';

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · VaultLedger`;
  }, [title]);
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/">
            <Logo />
          </Link>
          <Link to={IS_CLAUDE_EDITION ? '/app' : '/login'} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Back
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <Alert tone="warning" title="Template — review before going live">
          This page is a starting template written for the VaultLedger codebase. Have it reviewed and completed by a qualified
          professional for your jurisdiction and organisation before publishing the service.
        </Alert>
        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      {IS_CLAUDE_EDITION && (
        <section className="space-y-2">
          <h2>This edition</h2>
          <p>
            This copy of VaultLedger runs on claude.ai. You sign in with your Claude account, and VaultLedger never sees a password. Your
            records are kept in claude.ai’s storage, in a private space tied to your account that nobody else who opens the link can read,
            including the person who published it. Use “Delete all my data” on Profile &amp; Security to erase it. Anthropic’s own privacy
            policy covers your Claude account and the platform.
          </p>
        </section>
      )}
      <section className="space-y-2">
        <h2>What we store</h2>
        <ul>
          <li>Account details: your name, email address, optional phone number, and a one-way Argon2id hash of your password.</li>
          <li>Your records: item names, prices, currencies, quantities, categories, notes, tags and dates you enter, plus their price history.</li>
          <li>Security data: active sessions (device description, IP address, timestamps) and an activity history of sign-ins and changes.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>How it is used</h2>
        <p>Your data is used only to provide the service to you. Records are private to your account and are never shared with other users.</p>
        <p>
          Email (and SMS, if enabled) is used only for verification, password recovery and security notices. If the operator enables the
          breached-password check, only the first five characters of a SHA-1 hash of a new password are sent to the Have I Been Pwned
          service; the password itself never leaves the server.
        </p>
      </section>
      <section className="space-y-2">
        <h2>Retention and deletion</h2>
        <p>
          You can export all of your data at any time from Import / Export, and delete your account from Profile &amp; Security. Deleting
          your account permanently removes your profile, records, history, sessions and notifications from the live database immediately.
          Copies may persist in encrypted backups until those backups expire under the operator’s backup retention schedule (by default 30
          days).
        </p>
      </section>
      <section className="space-y-2">
        <h2>Cookies</h2>
        <p>
          VaultLedger uses strictly necessary cookies only: an HTTP-only session cookie and an HTTP-only anti-forgery (CSRF) cookie. Your
          theme and sidebar preferences are remembered in your browser’s local storage. No advertising or third-party tracking is used.
        </p>
      </section>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <section className="space-y-2">
        <h2>Using VaultLedger</h2>
        <p>
          VaultLedger lets you record items and their prices for your own reference. You are responsible for the accuracy of the
          information you enter and for keeping your password confidential.
        </p>
      </section>
      <section className="space-y-2">
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not attempt to access other users’ data or interfere with the service’s security.</li>
          <li>Do not use automated means to overload the service; rate limits apply.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>Availability and liability</h2>
        <p>
          The service is provided on an “as is” basis. Figures shown are calculated from the data you enter and are not financial,
          valuation, tax or insurance advice. Keep your own exports of important records.
        </p>
      </section>
      <section className="space-y-2">
        <h2>Ending your account</h2>
        <p>You can delete your account at any time from Profile &amp; Security. The operator may suspend accounts that breach these terms.</p>
      </section>
    </LegalLayout>
  );
}
