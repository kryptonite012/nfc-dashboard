import { BarChart3, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';

const POINTS = [
  { icon: Lock, title: 'Private by design', text: 'Your records are visible only to your account. Passwords are hashed with Argon2id.' },
  { icon: ShieldCheck, title: 'Secure sessions', text: 'HTTP-only cookies, automatic session rotation and one-click sign-out of every device.' },
  { icon: BarChart3, title: 'Exact totals', text: 'Prices are stored as exact amounts, so totals and averages never drift.' },
];

export function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · VaultLedger`;
  }, [title]);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-primary/20 blur-3xl"
        />
        <Link to="/" className="relative">
          <Logo />
        </Link>
        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">Know exactly what you own and what it cost.</h2>
            <p className="text-sidebar-muted">Record items and prices, track how your collection’s value changes, and export everything whenever you need it.</p>
          </div>
          <ul className="space-y-5">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar-accent">
                  <point.icon className="size-4 text-white" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{point.title}</span>
                  <span className="block text-sm text-sidebar-muted">{point.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-muted">© {new Date().getFullYear()} VaultLedger</p>
      </aside>

      <main className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md space-y-8">
          <Link to="/" className="inline-block lg:hidden">
            <Logo />
          </Link>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {children}
          {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
          <p className="text-center text-xs text-muted-foreground">
            <Link to="/privacy" className="hover:underline">
              Privacy Policy
            </Link>{' '}
            ·{' '}
            <Link to="/terms" className="hover:underline">
              Terms of Service
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
