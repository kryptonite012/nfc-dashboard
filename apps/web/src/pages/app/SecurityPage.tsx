import { zodResolver } from '@hookform/resolvers/zod';
import {
  changeEmailSchema,
  changePasswordSchema,
  DELETE_CONFIRMATION_PHRASE,
  PASSWORD_MIN_LENGTH,
  phoneStartSchema,
  phoneVerifySchema,
  updateProfileSchema,
  type SessionDTO,
  type UserDTO,
} from '@vaultledger/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Laptop, LogOut, Mail, Phone, ShieldAlert, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { PasswordInput, PasswordStrength } from '@/components/auth/PasswordInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, ErrorState, PageHeader } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { queryKeys, useConfig, useCurrentUser, useSessions } from '@/hooks/queries';
import { api, errorMessage, isApiError, resetCsrfToken } from '@/lib/api';
import { IS_CLAUDE_EDITION } from '@/lib/edition';
import { formatDateTime, formatRelative } from '@/lib/format';

function applyServerErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fallback: (message: string) => void) {
  if (isApiError(error) && Object.keys(error.fields).length) {
    for (const [key, message] of Object.entries(error.fields)) setError(key as Path<T>, { message });
  } else {
    fallback(errorMessage(error));
  }
}

function useSetUser() {
  const client = useQueryClient();
  return (user: UserDTO) => client.setQueryData(queryKeys.session, user);
}

function ProfileCard({ user }: { user: UserDTO }) {
  const setUser = useSetUser();
  const form = useForm<z.input<typeof updateProfileSchema>>({ resolver: zodResolver(updateProfileSchema), defaultValues: { name: user.name } });
  const submit = form.handleSubmit(async (values) => {
    try {
      const { data } = await api<UserDTO>('/api/account/profile', { method: 'PATCH', body: values });
      setUser(data);
      form.reset({ name: data.name });
      toast.success('Profile updated');
    } catch (error) {
      applyServerErrors(error, form.setError, (message) => toast.error(message));
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name appears in the app and in emails we send you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
          <Field id="profile-name" label="Full name" error={form.formState.errors.name?.message} className="flex-1">
            {(aria) => <Input {...aria} autoComplete="name" maxLength={100} {...form.register('name')} />}
          </Field>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmailCard({ user }: { user: UserDTO }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const form = useForm<z.input<typeof changeEmailSchema>>({ resolver: zodResolver(changeEmailSchema), defaultValues: { newEmail: '', password: '' } });
  const cancelPending = useMutation({
    mutationFn: () => api('/api/account/email/pending', { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.session }),
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      const { data } = await api<{ message: string }>('/api/account/email', { method: 'POST', body: values });
      toast.success(data.message);
      form.reset();
      setEditing(false);
      void client.invalidateQueries({ queryKey: queryKeys.session });
    } catch (error) {
      applyServerErrors(error, form.setError, (message) => toast.error(message));
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4 text-primary" aria-hidden /> Email address
        </CardTitle>
        <CardDescription>Used to sign in and to recover your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{user.email}</span>
          {user.emailVerified ? (
            <Badge variant="success">
              <CheckCircle2 className="size-3" aria-hidden /> Verified
            </Badge>
          ) : (
            <Badge variant="warning">Not verified</Badge>
          )}
        </div>
        {user.pendingEmail && (
          <Alert
            tone="info"
            title="Change pending"
            action={
              <Button size="sm" variant="outline" loading={cancelPending.isPending} onClick={() => cancelPending.mutate()}>
                Cancel change
              </Button>
            }
          >
            We sent a confirmation link to {user.pendingEmail}. Your sign-in email changes once you open it.
          </Alert>
        )}
        {editing ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
            <Field id="new-email" label="New email address" error={form.formState.errors.newEmail?.message}>
              {(aria) => <Input {...aria} type="email" autoComplete="email" {...form.register('newEmail')} />}
            </Field>
            <Field id="email-password" label="Current password" error={form.formState.errors.password?.message}>
              {(aria) => <PasswordInput {...aria} autoComplete="current-password" {...form.register('password')} />}
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" loading={form.formState.isSubmitting}>
                Send confirmation link
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Change email
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Runs a sensitive action, asking for the password first when the server requires recent authentication. */
function useReauth() {
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (err) {
      if (isApiError(err, 'REAUTH_REQUIRED')) setPending(() => action);
      else toast.error(errorMessage(err));
    }
  };

  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPending(null);
          setPassword('');
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api('/api/auth/reauth', { method: 'POST', body: { password } });
              const action = pending;
              setPending(null);
              setPassword('');
              await action?.();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirm it’s you</DialogTitle>
            <DialogDescription>Enter your password to continue with this sensitive change.</DialogDescription>
          </DialogHeader>
          <Field id="reauth-password" label="Password" error={error ?? undefined}>
            {(aria) => <PasswordInput {...aria} autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="submit" loading={busy} disabled={!password}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { run, dialog };
}

function PhoneCard({ user, smsEnabled }: { user: UserDTO; smsEnabled: boolean }) {
  const setUser = useSetUser();
  const reauth = useReauth();
  const [stage, setStage] = useState<'idle' | 'enter' | 'code'>('idle');
  const startForm = useForm<z.input<typeof phoneStartSchema>>({ resolver: zodResolver(phoneStartSchema), defaultValues: { phone: user.phone ?? '' } });
  const codeForm = useForm<z.input<typeof phoneVerifySchema>>({ resolver: zodResolver(phoneVerifySchema), defaultValues: { code: '' } });

  const start = startForm.handleSubmit(async (values) => {
    try {
      const { data } = await api<{ message: string }>('/api/account/phone/start', { method: 'POST', body: values });
      toast.success(data.message);
      setStage('code');
    } catch (error) {
      applyServerErrors(error, startForm.setError, (message) => startForm.setError('phone', { message }));
    }
  });

  const verify = codeForm.handleSubmit(async (values) => {
    try {
      const { data } = await api<UserDTO>('/api/account/phone/verify', { method: 'POST', body: values });
      setUser(data);
      toast.success('Phone number verified');
      setStage('idle');
      codeForm.reset();
    } catch (error) {
      applyServerErrors(error, codeForm.setError, (message) => codeForm.setError('code', { message }));
    }
  });

  const remove = () =>
    reauth.run(async () => {
      const { data } = await api<UserDTO>('/api/account/phone', { method: 'DELETE' });
      setUser(data);
      toast.success('Phone number removed');
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="size-4 text-primary" aria-hidden /> Phone number
        </CardTitle>
        <CardDescription>A verified number lets you sign in with your phone and reset your password by text message.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!smsEnabled ? (
          <Alert tone="info" title="Not available on this server">
            Phone verification needs an SMS provider. The administrator can enable it by configuring <code>SMS_PROVIDER</code> (see the
            configuration guide).
          </Alert>
        ) : (
          <>
            {user.phone ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{user.phone}</span>
                {user.phoneVerified ? (
                  <Badge variant="success">
                    <CheckCircle2 className="size-3" aria-hidden /> Verified
                  </Badge>
                ) : (
                  <Badge variant="warning">Not verified</Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No phone number on your account.</p>
            )}
            {stage === 'idle' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setStage('enter')}>
                  {user.phone ? (user.phoneVerified ? 'Change number' : 'Verify number') : 'Add phone number'}
                </Button>
                {user.phone && (
                  <Button size="sm" variant="ghost" onClick={() => void remove()}>
                    Remove
                  </Button>
                )}
              </div>
            )}
            {stage === 'enter' && (
              <form onSubmit={start} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
                <Field id="phone-number" label="Phone number with country code" error={startForm.formState.errors.phone?.message} className="flex-1">
                  {(aria) => <Input {...aria} type="tel" autoComplete="tel" placeholder="+91 98765 43210" {...startForm.register('phone')} />}
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" loading={startForm.formState.isSubmitting}>
                    Send code
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setStage('idle')}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {stage === 'code' && (
              <form onSubmit={verify} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
                <Field id="phone-code" label="6-digit code" error={codeForm.formState.errors.code?.message} hint="The code expires in 10 minutes." className="flex-1">
                  {(aria) => (
                    <Input
                      {...aria}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      autoFocus
                      className="tabular tracking-[0.4em]"
                      {...codeForm.register('code')}
                    />
                  )}
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" loading={codeForm.formState.isSubmitting}>
                    Verify
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setStage('enter')}>
                    Resend
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </CardContent>
      {reauth.dialog}
    </Card>
  );
}

function PasswordCard({ user, minLength }: { user: UserDTO; minLength: number }) {
  const form = useForm<z.input<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onTouched',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const newPassword = useWatch({ control: form.control, name: 'newPassword' });
  const client = useQueryClient();
  const submit = form.handleSubmit(async (values) => {
    try {
      const { data } = await api<{ message: string }>('/api/account/password', { method: 'POST', body: values });
      toast.success(data.message);
      form.reset();
      void client.invalidateQueries({ queryKey: queryKeys.sessions });
    } catch (error) {
      applyServerErrors(error, form.setError, (message) => toast.error(message));
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing your password signs out every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field id="current-password" label="Current password" error={form.formState.errors.currentPassword?.message} className="sm:col-span-2">
            {(aria) => <PasswordInput {...aria} autoComplete="current-password" {...form.register('currentPassword')} />}
          </Field>
          <Field id="new-password" label="New password" error={form.formState.errors.newPassword?.message}>
            {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...form.register('newPassword')} />}
          </Field>
          <Field id="confirm-new-password" label="Confirm new password" error={form.formState.errors.confirmPassword?.message}>
            {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...form.register('confirmPassword')} />}
          </Field>
          <div className="sm:col-span-2">
            <PasswordStrength password={newPassword ?? ''} userInputs={[user.name, user.email]} minLength={minLength} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={form.formState.isSubmitting}>
              Update password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard({ locale }: { locale: UserDTO['settings']['locale'] }) {
  const sessions = useSessions();
  const client = useQueryClient();
  const navigate = useNavigate();
  const revoke = useMutation({
    mutationFn: (session: SessionDTO) => api<{ signedOut: boolean }>(`/api/account/sessions/${session.id}`, { method: 'DELETE' }),
    onSuccess: ({ data }) => {
      if (data.signedOut) {
        resetCsrfToken();
        client.clear();
        client.setQueryData(queryKeys.session, null);
        navigate('/login');
        return;
      }
      toast.success('Session signed out');
      void client.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ revoked: number }>('/api/account/sessions/revoke-others', { method: 'POST' }),
    onSuccess: ({ data }) => {
      toast.success(`Signed out of ${data.revoked} other session(s)`);
      void client.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account. Sign out any you don’t recognise.</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          loading={revokeOthers.isPending}
          disabled={(sessions.data?.length ?? 0) < 2}
          onClick={() => revokeOthers.mutate()}
        >
          <LogOut /> Sign out others
        </Button>
      </CardHeader>
      <CardContent>
        {sessions.isError ? (
          <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
        ) : sessions.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y">
            {sessions.data.map((session) => {
              const Icon = /Android|iOS/.test(session.browser) ? Smartphone : Laptop;
              return (
                <li key={session.id} className="flex items-center gap-3 py-3">
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {session.browser}
                      {session.current && <Badge>This device</Badge>}
                      {session.persistent && <Badge variant="secondary">Remembered</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.ipAddress ? `IP ${session.ipAddress} · ` : ''}Active {formatRelative(session.lastActiveAt)} · Signed in{' '}
                      {formatDateTime(session.createdAt, locale)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(session)} disabled={revoke.isPending}>
                    {session.current ? 'Sign out' : 'Revoke'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DangerZone() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => api('/api/account', { method: 'DELETE', body: { password, confirmation: phrase } }),
    onSuccess: () => {
      resetCsrfToken();
      client.clear();
      client.setQueryData(queryKeys.session, null);
      navigate('/login?notice=deleted', { replace: true });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="size-4" aria-hidden /> Delete account
        </CardTitle>
        <CardDescription>
          Permanently deletes your profile, every record, price history, categories, activity, sessions and notifications. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setPassword('');
            setPhrase('');
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your data is removed from the live database immediately. Encrypted backups that contain it expire under the backup retention
              schedule described in the <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>. Consider{' '}
              <Link to="/app/data" className="text-primary hover:underline">downloading a full export</Link> first.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              remove.mutate();
            }}
          >
            {error && <Alert tone="error">{error}</Alert>}
            <Field id="delete-password" label="Password">
              {(aria) => <PasswordInput {...aria} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
            </Field>
            <Field id="delete-phrase" label={<>Type <span className="font-mono">{DELETE_CONFIRMATION_PHRASE}</span> to confirm</>}>
              {(aria) => <Input {...aria} autoComplete="off" value={phrase} onChange={(event) => setPhrase(event.target.value)} />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep my account
              </Button>
              <Button type="submit" variant="destructive" loading={remove.isPending} disabled={!password || phrase !== DELETE_CONFIRMATION_PHRASE}>
                Permanently delete
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Claude edition: identity comes from the viewer's Claude account, so there are no passwords or sessions here. */
function ClaudeAccountPage({ user }: { user: UserDTO }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api('/api/account', { method: 'DELETE', body: { confirmation: phrase } }),
    onSuccess: () => {
      setOpen(false);
      setPhrase('');
      void client.invalidateQueries();
      toast.success('All of your VaultLedger data has been deleted.');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Profile & Security" description="Your identity and the privacy of your records." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
            <CardDescription>You are signed in to VaultLedger with your Claude account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Name: </span>
              <span className="font-medium">{user.name}</span>
            </p>
            <p className="text-muted-foreground">
              Sign-in, sign-out, passwords and two-step verification are handled by claude.ai. To switch accounts, sign out of claude.ai and
              open this link again.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Privacy of your records
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Your records, categories and history are stored in your own private space for this app.</p>
            <p>Nobody else who opens this link can see them, including the person who published it.</p>
            <p>
              You can download everything at any time from <Link to="/app/data" className="font-medium text-primary hover:underline">Import / Export</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4" aria-hidden /> Delete all my data
          </CardTitle>
          <CardDescription>
            Permanently deletes every record, category, price history entry, activity entry and setting you have stored here. This cannot be
            undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 /> Delete all my data
          </Button>
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setPhrase('');
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all of your data?</DialogTitle>
            <DialogDescription>
              Consider <Link to="/app/data" className="text-primary hover:underline">downloading a full export</Link> first.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              remove.mutate();
            }}
          >
            {error && <Alert tone="error">{error}</Alert>}
            <Field id="delete-phrase" label={<>Type <span className="font-mono">{DELETE_CONFIRMATION_PHRASE}</span> to confirm</>}>
              {(aria) => <Input {...aria} autoComplete="off" value={phrase} onChange={(event) => setPhrase(event.target.value)} />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep my data
              </Button>
              <Button type="submit" variant="destructive" loading={remove.isPending} disabled={phrase !== DELETE_CONFIRMATION_PHRASE}>
                Permanently delete
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SecurityPage() {
  const user = useCurrentUser();
  if (IS_CLAUDE_EDITION) return <ClaudeAccountPage user={user} />;
  return <ServerSecurityPage user={user} />;
}

function ServerSecurityPage({ user }: { user: UserDTO }) {
  const config = useConfig();
  return (
    <div className="space-y-6">
      <PageHeader title="Profile & Security" description="Manage your identity, sign-in methods and active sessions." />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <ProfileCard user={user} />
          <EmailCard user={user} />
          <PhoneCard user={user} smsEnabled={config.data?.features.phoneAuth ?? false} />
        </div>
        <div className="space-y-6">
          <PasswordCard user={user} minLength={config.data?.passwordMinLength ?? PASSWORD_MIN_LENGTH} />
          <SessionsCard locale={user.settings.locale} />
        </div>
      </div>
      <DangerZone />
    </div>
  );
}
