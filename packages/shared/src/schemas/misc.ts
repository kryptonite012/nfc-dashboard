import { z } from 'zod';
import { currencySchema, isoDateSchema, timeZoneSchema } from './items';

export const CATEGORY_COLORS = [
  'slate',
  'blue',
  'indigo',
  'violet',
  'teal',
  'emerald',
  'amber',
  'orange',
  'rose',
  'cyan',
] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export const CATEGORY_NAME_MAX = 50;
export const CATEGORIES_PER_USER_MAX = 200;

export const categoryInputSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Category name is required')
    .max(CATEGORY_NAME_MAX, `Category name must be at most ${CATEGORY_NAME_MAX} characters`)
    .regex(/^[^\u0000-\u001f\u007f<>]*$/, 'Category name contains characters that are not allowed'),
  color: z.enum(CATEGORY_COLORS).default('blue'),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

export const LOCALES = ['en-IN', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP'] as const;
export type SupportedLocale = (typeof LOCALES)[number];

export const settingsSchema = z.strictObject({
  defaultCurrency: currencySchema,
  theme: z.enum(THEMES),
  locale: z.enum(LOCALES),
  showQuantity: z.boolean(),
});
export type SettingsInput = z.input<typeof settingsSchema>;
export const updateSettingsSchema = settingsSchema.partial();

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const analyticsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    granularity: z.enum(GRANULARITIES).default('day'),
    currency: currencySchema.optional(),
    tz: timeZoneSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ['to'],
    message: 'End date must be on or after the start date',
  });
export type AnalyticsQuery = z.input<typeof analyticsQuerySchema>;

export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 5_000;

export const importSchema = z.strictObject({
  csv: z.string().min(1, 'The file is empty').max(IMPORT_MAX_BYTES, 'The file is larger than 1 MB'),
  commit: z.boolean().default(false),
  defaultCurrency: currencySchema,
  createMissingCategories: z.boolean().default(true),
});
export type ImportInput = z.input<typeof importSchema>;

export const ACTIVITY_TYPES = [
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.email_verified',
  'auth.password_reset',
  'auth.password_changed',
  'auth.email_changed',
  'auth.phone_verified',
  'auth.phone_removed',
  'auth.session_revoked',
  'account.profile_updated',
  'account.settings_updated',
  'item.created',
  'item.updated',
  'item.deleted',
  'item.restored',
  'item.purged',
  'category.created',
  'category.updated',
  'category.deleted',
  'data.imported',
  'data.exported',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  scope: z.enum(['all', 'items', 'security', 'data']).default('all'),
});

export const notificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const markNotificationsSchema = z.strictObject({
  ids: z.array(z.uuid()).max(100).optional(),
  all: z.boolean().optional(),
});
