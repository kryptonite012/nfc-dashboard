import { KeyRound } from 'lucide-react';
import { Logo } from '@/components/layout/Logo';

/** Shown in the Claude edition when the viewer has no identity on the page or cannot use its storage. */
export function ClaudeAccessPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6 shadow-card">
        <Logo />
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Sign in to use VaultLedger</h1>
            <p className="text-sm text-muted-foreground">
              VaultLedger keeps your records in your own private space, tied to your Claude account. Sign in to claude.ai and open this
              link again.
            </p>
            <p className="text-sm text-muted-foreground">
              Already signed in? Ask the person who shared it to give you <span className="font-medium text-foreground">Contributor</span>{' '}
              access, which lets you save your own records. Nobody else, including the owner, can see them.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
