import { z } from 'zod';
import { CURRENCY_CODES, type CurrencyCode } from '../currencies';
import { parseMoney } from '../money';

export const ITEM_NAME_MAX = 120;
export const ITEM_SKU_MAX = 64;
export const ITEM_DESCRIPTION_MAX = 2000;
export const ITEM_SUPPLIER_MAX = 120;
export const ITEM_TAG_MAX = 32;
export const ITEM_TAGS_MAX = 20;
export const QUANTITY_MAX = 1_000_000;
export const PAGE_SIZE_MAX = 100;
export const BULK_MAX = 100;

const NO_CONTROL_CHARS = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

export const currencySchema = z.enum(CURRENCY_CODES, 'Choose a supported currency');

const textField = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .regex(NO_CONTROL_CHARS, `${label} contains characters that are not allowed`);

/** Optional text: empty strings become null so they clear the stored value. */
const optionalText = (label: string, max: number) =>
  z
    .union([textField(label, max), z.null()])
    .optional()
    .transform((value) => (value ? value : null));

export const itemNameSchema = textField('Item name', ITEM_NAME_MAX).min(1, 'Item name is required');

export const priceStringSchema = z
  .string()
  .trim()
  .min(1, 'Price is required')
  .max(24, 'Price is too long');

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Tags cannot be empty')
  .max(ITEM_TAG_MAX, `Tags must be at most ${ITEM_TAG_MAX} characters`)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u, 'Tags may contain letters, numbers, spaces, dots, dashes and underscores');

export const tagsSchema = z
  .array(tagSchema)
  .max(ITEM_TAGS_MAX, `Use at most ${ITEM_TAGS_MAX} tags`)
  .transform((tags) => Array.from(new Set(tags)));

export const isoDateSchema = z.iso.date('Use a valid date (YYYY-MM-DD)');

/** IANA time zone used to interpret date filters (e.g. "Asia/Kolkata"). Validated on the server. */
export const timeZoneSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/, 'Invalid time zone');

const MONEY_MESSAGES: Record<'format' | 'precision' | 'range', (currency: CurrencyCode) => string> = {
  format: () => 'Enter a valid, non-negative amount',
  precision: (currency) => `Too many decimal places for ${currency}`,
  range: () => 'Amount is too large',
};

/** Adds a price-validation issue at `path` when `price` is not valid for `currency`. */
export function validatePriceForCurrency(
  price: string,
  currency: CurrencyCode,
  ctx: z.RefinementCtx,
  path: (string | number)[] = ['price'],
) {
  const parsed = parseMoney(price, currency);
  if (!parsed.ok) ctx.addIssue({ code: 'custom', path, message: MONEY_MESSAGES[parsed.error](currency) });
}

const itemFields = {
  name: itemNameSchema,
  price: priceStringSchema,
  currency: currencySchema,
  quantity: z
    .number('Quantity must be a whole number')
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(QUANTITY_MAX, `Quantity must be at most ${QUANTITY_MAX.toLocaleString('en-US')}`),
  categoryId: z.union([z.uuid('Invalid category'), z.null()]).optional().transform((value) => value ?? null),
  sku: optionalText('SKU / reference', ITEM_SKU_MAX),
  description: optionalText('Description', ITEM_DESCRIPTION_MAX),
  supplier: optionalText('Supplier', ITEM_SUPPLIER_MAX),
  purchaseDate: z.union([isoDateSchema, z.null(), z.literal('')]).optional().transform((value) => value || null),
  tags: tagsSchema.optional().default([]),
};

/** Body accepted by `POST /api/items`. */
export const createItemSchema = z
  .strictObject({
    ...itemFields,
    quantity: itemFields.quantity.optional().default(1),
  })
  .superRefine((value, ctx) => validatePriceForCurrency(value.price, value.currency, ctx));
export type CreateItemInput = z.input<typeof createItemSchema>;
export type CreateItemData = z.output<typeof createItemSchema>;

/** Body accepted by `PATCH /api/items/:id`. `version` enables optimistic concurrency control. */
export const updateItemSchema = z
  .strictObject({
    name: itemFields.name.optional(),
    price: itemFields.price.optional(),
    currency: itemFields.currency.optional(),
    quantity: itemFields.quantity.optional(),
    categoryId: z.union([z.uuid('Invalid category'), z.null()]).optional(),
    sku: itemFields.sku,
    description: itemFields.description,
    supplier: itemFields.supplier,
    purchaseDate: z.union([isoDateSchema, z.null(), z.literal('')]).optional(),
    tags: tagsSchema.optional(),
    version: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), 'No changes supplied');
export type UpdateItemInput = z.input<typeof updateItemSchema>;

/**
 * Form-level schema used by the web client. Values are kept as strings while
 * the user types and converted into a {@link CreateItemInput} on submit.
 */
export const itemFormSchema = z
  .object({
    name: itemNameSchema,
    price: priceStringSchema,
    currency: currencySchema,
    quantity: z
      .string()
      .trim()
      .regex(/^\d{1,7}$/, 'Quantity must be a whole number')
      .refine((value) => Number(value) >= 1, 'Quantity must be at least 1')
      .refine((value) => Number(value) <= QUANTITY_MAX, `Quantity must be at most ${QUANTITY_MAX.toLocaleString('en-US')}`),
    categoryId: z.string(),
    sku: textField('SKU / reference', ITEM_SKU_MAX),
    description: textField('Description', ITEM_DESCRIPTION_MAX),
    supplier: textField('Supplier', ITEM_SUPPLIER_MAX),
    purchaseDate: z.union([z.literal(''), isoDateSchema]),
    tags: z.string().max(ITEM_TAGS_MAX * (ITEM_TAG_MAX + 2), 'Too many tags'),
  })
  .superRefine((value, ctx) => {
    validatePriceForCurrency(value.price, value.currency, ctx);
    const tags = splitTags(value.tags);
    const result = tagsSchema.safeParse(tags);
    if (!result.success) {
      ctx.addIssue({ code: 'custom', path: ['tags'], message: result.error.issues[0]?.message ?? 'Invalid tags' });
    }
  });
export type ItemFormValues = z.input<typeof itemFormSchema>;

export function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export const ITEM_SORT_FIELDS = ['name', 'price', 'createdAt', 'updatedAt'] as const;

const optionalQueryString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

/** Query string accepted by `GET /api/items`. */
export const itemListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
    q: z.string().trim().max(100).optional().transform((value) => (value ? value : undefined)),
    sort: z.enum(ITEM_SORT_FIELDS).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    categoryId: z.union([z.uuid(), z.literal('none')]).optional(),
    currency: currencySchema.optional(),
    minPrice: optionalQueryString,
    maxPrice: optionalQueryString,
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    tag: tagSchema.optional(),
    tz: timeZoneSchema.optional(),
    status: z.enum(['active', 'deleted']).default('active'),
  })
  .superRefine((value, ctx) => {
    if ((value.minPrice || value.maxPrice) && !value.currency) {
      ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Select a currency to filter by price' });
      return;
    }
    if (value.currency) {
      if (value.minPrice) validatePriceForCurrency(value.minPrice, value.currency, ctx, ['minPrice']);
      if (value.maxPrice) validatePriceForCurrency(value.maxPrice, value.currency, ctx, ['maxPrice']);
    }
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'End date must be on or after the start date' });
    }
  });
export type ItemListQuery = z.input<typeof itemListQuerySchema>;

export const bulkActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.enum(['delete', 'restore', 'purge']),
    ids: z.array(z.uuid()).min(1, 'Select at least one record').max(BULK_MAX),
  }),
  z.strictObject({
    action: z.literal('setCategory'),
    ids: z.array(z.uuid()).min(1, 'Select at least one record').max(BULK_MAX),
    categoryId: z.union([z.uuid(), z.null()]),
  }),
]);
export type BulkActionInput = z.input<typeof bulkActionSchema>;
