import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput, type UserDTO } from '@vaultledger/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Checkbox, Label } from '@/components/ui/primitives';
import { queryKeys, useConfig } from '@/hooks/queries';
import { api, errorMessage, isApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/utils';

const NOTICES: Record<string, { tone: 'success' | 'info'; text: string }> = {
  verified: { tone: 'success', text: 'Your email address is verified. Sign in to continue.' },
  reset: { tone: 'success', text: 'Your password has been reset. Sign in with your new password.' },
  deleted: { tone: 'info', text: 'Your account has been deleted.' },
  expired: { tone: 'info', text: 'Your session ended. Please sign in again.' },
};

export function LoginPage() {
  const config = useConfig();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [resending, setResending] = useState(false);
  const phoneAuth = config.data?.features.phoneAuth ?? false;
  const notice = NOTICES[params.get('notice') ?? ''];

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '', remember: false },
  });
  const { register, handleSubmit, formState, control, getValues } = form;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const { data } = await api<{ user: UserDTO }>('/api/auth/login', { method: 'POST', body: values });
      client.setQueryData(queryKeys.session, data.user);
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}`);
      navigate(safeNextPath(params.get('next')), { replace: true });
    } catch (err) {
      setError({ code: isApiError(err) ? err.code : 'UNKNOWN', message: errorMessage(err) });
    }
  });

  const resendVerification = async () => {
    const email = getValues('identifier').trim();
    if (!email.includes('@')) return;
    setResending(true);
    try {
      await api('/api/auth/resend-verification', { method: 'POST', body: { email } });
      toast.success('If your address still needs verification, a new link is on its way.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to manage your records."
      footer={
        <>
          New to VaultLedger?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {error && (
          <Alert
            tone={error.code === 'EMAIL_NOT_VERIFIED' ? 'warning' : 'error'}
            title={error.code === 'EMAIL_NOT_VERIFIED' ? 'Email not verified' : 'Sign-in failed'}
            action={
              error.code === 'EMAIL_NOT_VERIFIED' && getValues('identifier').includes('@') ? (
                <Button type="button" size="sm" variant="outline" loading={resending} onClick={resendVerification}>
                  Resend link
                </Button>
              ) : undefined
            }
          >
            {error.message}
          </Alert>
        )}

        <Field id="identifier" label={phoneAuth ? 'Email or phone number' : 'Email address'} error={formState.errors.identifier?.message}>
          {(aria) => (
            <Input
              {...aria}
              type={phoneAuth ? 'text' : 'email'}
              autoComplete="username"
              inputMode={phoneAuth ? 'text' : 'email'}
              placeholder={phoneAuth ? 'you@example.com or +91 98765 43210' : 'you@example.com'}
              autoFocus
              {...register('identifier')}
            />
          )}
        </Field>

        <Field
          id="password"
          label="Password"
          error={formState.errors.password?.message}
          labelAside={
            <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          }
        >
          {(aria) => <PasswordInput {...aria} autoComplete="current-password" {...register('password')} />}
        </Field>

        <div className="flex items-center gap-2">
          <Controller
            control={control}
            name="remember"
            render={({ field }) => (
              <Checkbox id="remember" checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
            )}
          />
          <Label htmlFor="remember" className="font-normal">
            Keep me signed in on this device for 30 days
          </Label>
        </div>

        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          Sign in
        </Button>
        {!phoneAuth && config.isSuccess && (
          <p className="text-center text-xs text-muted-foreground">Phone-number sign-in becomes available once an SMS provider is configured.</p>
        )}
      </form>
    </AuthLayout>
  );
}
