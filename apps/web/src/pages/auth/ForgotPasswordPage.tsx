import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@vaultledger/shared';
import { MailCheck, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useConfig } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';

type Values = z.input<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const config = useConfig();
  const phoneAuth = config.data?.features.phoneAuth ?? false;
  const [sent, setSent] = useState<{ channel: 'email' | 'sms'; identifier: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { identifier: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const { data } = await api<{ channel: 'email' | 'sms' }>('/api/auth/password/forgot', { method: 'POST', body: values });
      setSent({ channel: data.channel, identifier: values.identifier.trim() });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Reset your password"
      description={
        phoneAuth
          ? 'Enter the email address or verified phone number on your account.'
          : 'Enter the email address on your account and we’ll send you a reset link.'
      }
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
            {sent.channel === 'email' ? (
              <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            ) : (
              <MessageSquareText className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            )}
            <p className="text-sm">
              {sent.channel === 'email'
                ? 'If an account uses that address, we’ve emailed a link to reset your password. It expires in 30 minutes.'
                : 'If an account uses that verified number, we’ve texted a 6-digit code. It expires in 10 minutes.'}
            </p>
          </div>
          {sent.channel === 'sms' && (
            <Button asChild className="w-full">
              <Link to={`/reset-password?phone=${encodeURIComponent(sent.identifier)}`}>Enter the code</Link>
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={() => setSent(null)}>
            Try a different {phoneAuth ? 'email or phone' : 'email'}
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field id="identifier" label={phoneAuth ? 'Email or phone number' : 'Email address'} error={form.formState.errors.identifier?.message}>
            {(aria) => <Input {...aria} autoFocus autoComplete="username" {...form.register('identifier')} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Send reset instructions
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
