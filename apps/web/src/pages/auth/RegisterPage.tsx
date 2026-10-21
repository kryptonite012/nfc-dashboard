import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, registerSchema, type RegisterInput } from '@vaultledger/shared';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch, type Path } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordInput, PasswordStrength } from '@/components/auth/PasswordInput';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Checkbox, Label } from '@/components/ui/primitives';
import { useConfig } from '@/hooks/queries';
import { api, errorMessage, isApiError } from '@/lib/api';

export function RegisterPage() {
  const config = useConfig();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const phoneAuth = config.data?.features.phoneAuth ?? false;
  const phoneRequired = config.data?.requirePhoneOnSignup ?? false;

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', phone: '', password: '', confirmPassword: '', acceptTerms: false as unknown as true },
  });
  const { register, handleSubmit, formState, control, setError } = form;
  const [password, name, email] = useWatch({ control, name: ['password', 'name', 'email'] });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (phoneRequired && !values.phone) {
      setError('phone', { message: 'Phone number is required' });
      return;
    }
    try {
      await api('/api/auth/register', { method: 'POST', body: values });
      setSubmittedEmail(values.email.trim().toLowerCase());
    } catch (error) {
      if (isApiError(error) && Object.keys(error.fields).length) {
        for (const [key, message] of Object.entries(error.fields)) setError(key as Path<RegisterInput>, { message });
      } else {
        setFormError(errorMessage(error));
      }
    }
  });

  const resend = async () => {
    if (!submittedEmail) return;
    setResending(true);
    try {
      await api('/api/auth/resend-verification', { method: 'POST', body: { email: submittedEmail } });
      toast.success('A new verification link is on its way.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setResending(false);
    }
  };

  if (submittedEmail) {
    return (
      <AuthLayout title="Check your inbox" description="One more step to activate your account.">
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm">
              We sent a verification link to <span className="font-semibold">{submittedEmail}</span>. Open it to verify your address, then
              sign in. The link expires in 24 hours.
            </p>
          </div>
          {config.data?.features.emailDelivery === 'outbox' && (
            <Alert tone="warning" title="Development mode">
              Email delivery is not configured, so messages are written to the API’s <code>.mail-outbox/</code> folder instead of being sent.
            </Alert>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" loading={resending} onClick={resend}>
              Resend email
            </Button>
            <Button asChild className="flex-1">
              <Link to="/login">Go to sign in</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Didn’t get it? Check spam, or make sure the address is right. If you already have an account, we sent you a sign-in reminder instead.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Start recording items and prices securely."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError && <Alert tone="error" title="We couldn’t create your account">{formError}</Alert>}
        <Field id="name" label="Full name" required error={formState.errors.name?.message}>
          {(aria) => <Input {...aria} autoComplete="name" autoFocus maxLength={100} {...register('name')} />}
        </Field>
        <Field id="email" label="Email address" required error={formState.errors.email?.message}>
          {(aria) => <Input {...aria} type="email" autoComplete="email" inputMode="email" {...register('email')} />}
        </Field>
        {phoneAuth && (
          <Field
            id="phone"
            label={phoneRequired ? 'Phone number' : 'Phone number (optional)'}
            required={phoneRequired}
            error={formState.errors.phone?.message}
            hint="Include the country code. You’ll verify it with a one-time code after signing in."
          >
            {(aria) => <Input {...aria} type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" {...register('phone')} />}
          </Field>
        )}
        <Field id="password" label="Password" required error={formState.errors.password?.message}>
          {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register('password')} />}
        </Field>
        <PasswordStrength password={password ?? ''} userInputs={[name ?? '', email ?? '']} minLength={config.data?.passwordMinLength ?? PASSWORD_MIN_LENGTH} />
        <Field id="confirmPassword" label="Confirm password" required error={formState.errors.confirmPassword?.message}>
          {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register('confirmPassword')} />}
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <Controller
              control={control}
              name="acceptTerms"
              render={({ field }) => (
                <Checkbox
                  id="acceptTerms"
                  className="mt-0.5"
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  aria-invalid={Boolean(formState.errors.acceptTerms)}
                  aria-describedby={formState.errors.acceptTerms ? 'acceptTerms-error' : undefined}
                />
              )}
            />
            <Label htmlFor="acceptTerms" className="font-normal leading-snug">
              I agree to the{' '}
              <Link to="/terms" target="_blank" className="font-medium text-primary hover:underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link to="/privacy" target="_blank" className="font-medium text-primary hover:underline">
                Privacy Policy
              </Link>
              .
            </Label>
          </div>
          {formState.errors.acceptTerms && (
            <p id="acceptTerms-error" className="text-xs font-medium text-destructive">
              {formState.errors.acceptTerms.message}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
