import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, resetPasswordWithCodeSchema, resetPasswordWithTokenSchema } from '@vaultledger/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch, type Path } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordInput, PasswordStrength } from '@/components/auth/PasswordInput';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { queryKeys } from '@/hooks/queries';
import { api, errorMessage, isApiError } from '@/lib/api';

type TokenValues = z.input<typeof resetPasswordWithTokenSchema>;
type CodeValues = z.input<typeof resetPasswordWithCodeSchema>;

export function ResetPasswordPage() {
  // Capture the token once and strip it from the address bar.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const token = params.get('token');
  const phone = params.get('phone');
  useEffect(() => {
    if (token) window.history.replaceState(null, '', window.location.pathname);
  }, [token]);

  return (
    <AuthLayout
      title="Choose a new password"
      description="Resetting your password signs you out on every device."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {token ? <TokenForm token={token} /> : <CodeForm phone={phone ?? ''} />}
    </AuthLayout>
  );
}

function useResetSuccess() {
  const navigate = useNavigate();
  const client = useQueryClient();
  return () => {
    client.setQueryData(queryKeys.session, null);
    navigate('/login?notice=reset', { replace: true });
  };
}

function TokenForm({ token }: { token: string }) {
  const done = useResetSuccess();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<TokenValues>({
    resolver: zodResolver(resetPasswordWithTokenSchema),
    mode: 'onTouched',
    defaultValues: { token, password: '', confirmPassword: '' },
  });
  const password = useWatch({ control: form.control, name: 'password' });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/api/auth/password/reset', { method: 'POST', body: values });
      done();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) {
        for (const [key, message] of Object.entries(err.fields)) form.setError(key as Path<TokenValues>, { message });
      } else setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && (
        <Alert tone="error" title="Password not changed">
          {error} <Link to="/forgot-password">Request a new link</Link>
        </Alert>
      )}
      <Field id="password" label="New password" required error={form.formState.errors.password?.message}>
        {(aria) => <PasswordInput {...aria} autoFocus autoComplete="new-password" {...form.register('password')} />}
      </Field>
      <PasswordStrength password={password ?? ''} minLength={PASSWORD_MIN_LENGTH} />
      <Field id="confirmPassword" label="Confirm new password" required error={form.formState.errors.confirmPassword?.message}>
        {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...form.register('confirmPassword')} />}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Reset password
      </Button>
    </form>
  );
}

function CodeForm({ phone }: { phone: string }) {
  const done = useResetSuccess();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CodeValues>({
    resolver: zodResolver(resetPasswordWithCodeSchema),
    mode: 'onTouched',
    defaultValues: { phone, code: '', password: '', confirmPassword: '' },
  });
  const password = useWatch({ control: form.control, name: 'password' });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/api/auth/password/reset-with-code', { method: 'POST', body: values });
      done();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) {
        for (const [key, message] of Object.entries(err.fields)) form.setError(key as Path<CodeValues>, { message });
      } else setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <Alert tone="info">
        No code? Reset links for email addresses arrive by email. <Link to="/forgot-password">Request instructions</Link>.
      </Alert>
      <Field id="phone" label="Phone number" required error={form.formState.errors.phone?.message}>
        {(aria) => <Input {...aria} type="tel" autoComplete="tel" {...form.register('phone')} />}
      </Field>
      <Field id="code" label="6-digit code" required error={form.formState.errors.code?.message}>
        {(aria) => (
          <Input {...aria} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tabular tracking-[0.4em]" {...form.register('code')} />
        )}
      </Field>
      <Field id="password" label="New password" required error={form.formState.errors.password?.message}>
        {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...form.register('password')} />}
      </Field>
      <PasswordStrength password={password ?? ''} minLength={PASSWORD_MIN_LENGTH} />
      <Field id="confirmPassword" label="Confirm new password" required error={form.formState.errors.confirmPassword?.message}>
        {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...form.register('confirmPassword')} />}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Reset password
      </Button>
    </form>
  );
}
