import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 100;
export const OTP_LENGTH = 6;

/** Trimmed, lower-cased email address (RFC 5321 length limit). */
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

/**
 * Loose client-side phone shape check. The server performs authoritative
 * parsing and normalisation to E.164.
 */
export const phoneInputSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .max(32, 'Phone number is too long')
  .regex(/^\+?[0-9][0-9 ()\-.]{5,30}$/, 'Enter a valid phone number, including the country code');

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, 'Full name is required')
  .max(NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters`)
  .refine((value) => !/[\u0000-\u001f\u007f<>]/.test(value), 'Name contains characters that are not allowed');

/**
 * Structural password rules. Strength (guessability, breached/common
 * passwords) is enforced additionally on the server.
 */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => value.trim().length === value.length, 'Password must not start or end with spaces');

/** Passwords supplied for authentication are only length-checked. */
const existingPasswordSchema = z
  .string()
  .min(1, 'Password is required')
  .max(PASSWORD_MAX_LENGTH, 'Password is too long');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

const opaqueTokenSchema = z
  .string()
  .trim()
  .min(20, 'Invalid or expired link')
  .max(200, 'Invalid or expired link')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid or expired link');

const optionalPhone = z
  .union([z.literal(''), phoneInputSchema])
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * Confirmation-field check that also runs when unrelated fields are invalid,
 * so users see every problem at once.
 */
function passwordsMatch<K extends string>(passwordKey: K) {
  const check = (value: Record<K | 'confirmPassword', unknown>) => value[passwordKey] === value.confirmPassword;
  const params: z.core.$ZodCustomParams = {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
    when: (payload) =>
      payload.issues.every((issue) => {
        const field = issue.path?.[0];
        return field !== passwordKey && field !== 'confirmPassword';
      }),
  };
  return [check, params] as const;
}

export const registerSchema = z
  .strictObject({
    name: fullNameSchema,
    email: emailSchema,
    phone: optionalPhone,
    password: newPasswordSchema,
    confirmPassword: z.string().max(PASSWORD_MAX_LENGTH),
    acceptTerms: z.literal(true, 'You must accept the Terms of Service and Privacy Policy'),
  })
  .refine(...passwordsMatch('password'));
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.strictObject({
  identifier: z.string().trim().min(1, 'Email or phone number is required').max(254),
  password: existingPasswordSchema,
  remember: z.boolean().optional().default(false),
});
export type LoginInput = z.input<typeof loginSchema>;

export const verifyEmailSchema = z.strictObject({ token: opaqueTokenSchema });

export const resendVerificationSchema = z.strictObject({ email: emailSchema });

export const forgotPasswordSchema = z.strictObject({
  identifier: z.string().trim().min(1, 'Email or phone number is required').max(254),
});

export const resetPasswordWithTokenSchema = z
  .strictObject({
    token: opaqueTokenSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().max(PASSWORD_MAX_LENGTH),
  })
  .refine(...passwordsMatch('password'));

export const resetPasswordWithCodeSchema = z
  .strictObject({
    phone: phoneInputSchema,
    code: otpCodeSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().max(PASSWORD_MAX_LENGTH),
  })
  .refine(...passwordsMatch('password'));

export const phoneStartSchema = z.strictObject({ phone: phoneInputSchema });
export const phoneVerifySchema = z.strictObject({ code: otpCodeSchema });

export const changePasswordSchema = z
  .strictObject({
    currentPassword: existingPasswordSchema,
    newPassword: newPasswordSchema,
    confirmPassword: z.string().max(PASSWORD_MAX_LENGTH),
  })
  .refine(...passwordsMatch('newPassword'))
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one',
  });

export const changeEmailSchema = z.strictObject({
  newEmail: emailSchema,
  password: existingPasswordSchema,
});

export const updateProfileSchema = z.strictObject({ name: fullNameSchema });

export const DELETE_CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';

export const deleteAccountSchema = z.strictObject({
  password: existingPasswordSchema,
  confirmation: z.literal(DELETE_CONFIRMATION_PHRASE, `Type "${DELETE_CONFIRMATION_PHRASE}" to confirm`),
});

export const reauthSchema = z.strictObject({ password: existingPasswordSchema });
