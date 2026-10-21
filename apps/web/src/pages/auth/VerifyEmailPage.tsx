import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { queryKeys, useSession } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';

type State = { status: 'working' } | { status: 'done'; kind: 'verified' | 'changed' } | { status: 'error'; message: string };

export function VerifyEmailPage() {
  // Read the token once, then remove it from the address bar and browser history.
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token'));
  const [state, setState] = useState<State>(token ? { status: 'working' } : { status: 'error', message: 'This link is incomplete.' });
  const started = useRef(false);
  const session = useSession();
  const client = useQueryClient();

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
    if (!token || started.current) return;
    started.current = true;
    api<{ kind: 'verified' | 'changed' }>('/api/auth/verify-email', { method: 'POST', body: { token } })
      .then(({ data }) => {
        setState({ status: 'done', kind: data.kind });
        void client.invalidateQueries({ queryKey: queryKeys.session });
      })
      .catch((error: unknown) => setState({ status: 'error', message: errorMessage(error) }));
  }, [token, client]);

  const signedIn = Boolean(session.data);

  return (
    <AuthLayout title="Email verification">
      <div className="space-y-6 rounded-lg border bg-card p-6 text-center shadow-card">
        {state.status === 'working' && (
          <div className="flex flex-col items-center gap-3" role="status">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">Verifying your email address…</p>
          </div>
        )}
        {state.status === 'done' && (
          <div className="flex flex-col items-center gap-3" role="status">
            <CheckCircle2 className="size-10 text-success" aria-hidden />
            <p className="font-semibold">{state.kind === 'changed' ? 'Your email address has been updated' : 'Your email address is verified'}</p>
            <p className="text-sm text-muted-foreground">
              {state.kind === 'changed' ? 'Use your new address the next time you sign in.' : 'You can now sign in to your account.'}
            </p>
            <Button asChild className="mt-2">
              {signedIn ? <Link to="/app/security">Back to Profile &amp; Security</Link> : <Link to="/login?notice=verified">Continue to sign in</Link>}
            </Button>
          </div>
        )}
        {state.status === 'error' && (
          <div className="flex flex-col items-center gap-3" role="alert">
            <XCircle className="size-10 text-destructive" aria-hidden />
            <p className="font-semibold">We couldn’t verify this link</p>
            <p className="text-sm text-muted-foreground">{state.message} Verification links expire after 24 hours and work only once.</p>
            <div className="mt-2 flex gap-2">
              <Button asChild variant="outline">
                <Link to="/login">Sign in to request a new link</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
