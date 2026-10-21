import {
  activityQuerySchema,
  analyticsQuerySchema,
  bulkActionSchema,
  CATEGORIES_PER_USER_MAX,
  categoryInputSchema,
  createItemSchema,
  DELETE_CONFIRMATION_PHRASE,
  importSchema,
  itemListQuerySchema,
  markNotificationsSchema,
  minorToDecimalString,
  parseMoney,
  PASSWORD_MIN_LENGTH,
  updateItemSchema,
  updateSettingsSchema,
  type ActivityDTO,
  type ActivityType,
  type CategoryDTO,
  type CurrencyCode,
  type ImportResultDTO,
  type ImportRowResult,
  type NotificationDTO,
  type PublicConfig,
  type UserDTO,
} from '@vaultledger/shared';
import { z, type ZodType } from 'zod';
import { ApiError, type ApiResponse, type RequestOptions } from '@/lib/api';
import { computeAnalytics, computeOverview, localDate, priceHistoryDTO, toItemDTO } from './compute';
import { csvRow, parseCsv } from './csv';
import { store, type StoredCategory, type StoredItem } from './store';

/**
 * The Claude edition's API: answers the same routes, with the same validation,
 * error codes and response shapes as the Express server, from the viewer's
 * private storage. Pages and hooks call `api()` exactly as they do against the server.
 */

type Query = Record<string, string>;
interface Context {
  params: Record<string, string>;
  query: Query;
  body: unknown;
  headers: Record<string, string>;
}
type Handler = (ctx: Context) => Promise<ApiResponse<unknown, unknown>>;

const IMPORT_MAX_ROWS_HERE = 1000;

function invalid(error: z.ZodError, message = 'Please correct the highlighted fields'): ApiError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return new ApiError(422, 'VALIDATION_FAILED', message, fields);
}

function parse<S extends ZodType>(schema: S, value: unknown, message?: string): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw invalid(result.error, message);
  return result.data;
}

const notFound = (what = 'Item') => new ApiError(404, 'NOT_FOUND', `${what} not found`);

function toMinor(price: string, currency: CurrencyCode): bigint {
  const parsed = parseMoney(price, currency);
  if (!parsed.ok) throw new ApiError(422, 'VALIDATION_FAILED', 'Invalid price', { price: 'Enter a valid, non-negative amount' });
  return parsed.minor;
}

const lineValue = (priceMinor: bigint | string, quantity: number) => BigInt(priceMinor) * BigInt(quantity);

function userDTO(): UserDTO {
  return {
    id: store.uid!,
    name: store.displayName || 'You',
    email: '',
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    pendingEmail: null,
    createdAt: store.profile.createdAt,
    settings: store.profile.settings,
  };
}

function log(type: ActivityType, summary: string, entityId: string | null = null) {
  void store.logActivity({ type, summary: summary.slice(0, 300), entityId });
}

function assertCategory(categoryId: string | null | undefined) {
  if (categoryId && !store.categories.has(categoryId)) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Unknown category', { categoryId: 'Choose one of your categories' });
  }
}

// ---------------------------------------------------------------- items

type ListQuery = z.output<typeof itemListQuerySchema>;

function filterItems(query: ListQuery): StoredItem[] {
  const tz = query.tz ?? 'UTC';
  const term = query.q?.toLowerCase();
  const min = query.currency && query.minPrice ? toMinor(query.minPrice, query.currency) : null;
  const max = query.currency && query.maxPrice ? toMinor(query.maxPrice, query.currency) : null;
  return [...store.items.values()].filter((item) => {
    if (query.status === 'deleted' ? !item.deletedAt : item.deletedAt) return false;
    if (term) {
      const haystack = [item.name, item.sku, item.description, item.supplier].filter(Boolean).join('\n').toLowerCase();
      if (!haystack.includes(term) && !item.tags.includes(term)) return false;
    }
    if (query.categoryId === 'none' ? item.categoryId !== null : query.categoryId && item.categoryId !== query.categoryId) return false;
    if (query.tag && !item.tags.includes(query.tag)) return false;
    if (query.currency && item.currency !== query.currency) return false;
    if (min !== null && BigInt(item.priceMinor) < min) return false;
    if (max !== null && BigInt(item.priceMinor) > max) return false;
    if (query.from || query.to) {
      const day = localDate(item.createdAt, tz);
      if (query.from && day < query.from) return false;
      if (query.to && day > query.to) return false;
    }
    return true;
  });
}

function sortItems(items: StoredItem[], sort: ListQuery['sort'], order: ListQuery['order']): StoredItem[] {
  const direction = order === 'asc' ? 1 : -1;
  const compare = (a: StoredItem, b: StoredItem): number => {
    let result = 0;
    if (sort === 'name') result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    else if (sort === 'price') {
      const diff = BigInt(a.priceMinor) - BigInt(b.priceMinor);
      result = diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } else result = a[sort].localeCompare(b[sort]);
    return (result || a.id.localeCompare(b.id)) * direction;
  };
  return [...items].sort(compare);
}

function newItem(data: z.output<typeof createItemSchema>, now: string, clientRequestId: string | null): StoredItem {
  const priceMinor = toMinor(data.price, data.currency);
  return {
    id: crypto.randomUUID(),
    name: data.name,
    priceMinor: priceMinor.toString(),
    currency: data.currency,
    quantity: data.quantity,
    categoryId: data.categoryId,
    sku: data.sku,
    description: data.description,
    supplier: data.supplier,
    purchaseDate: data.purchaseDate,
    tags: data.tags,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    history: [{ p: priceMinor.toString(), c: data.currency, q: data.quantity, at: now }],
    events: [{ k: 'ADD', c: data.currency, d: lineValue(priceMinor, data.quantity).toString(), at: now }],
    ...(clientRequestId ? { clientRequestId } : {}),
  };
}

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  priceMinor: 'price',
  currency: 'currency',
  quantity: 'quantity',
  categoryId: 'category',
  sku: 'SKU',
  description: 'description',
  supplier: 'supplier',
  purchaseDate: 'purchase date',
  tags: 'tags',
};

async function softDelete(ids: string[]): Promise<number> {
  const now = new Date().toISOString();
  const targets = ids.map((id) => store.items.get(id)).filter((item): item is StoredItem => Boolean(item && !item.deletedAt));
  for (const item of targets) {
    await store.saveItem({
      ...item,
      deletedAt: now,
      version: item.version + 1,
      events: [...item.events, { k: 'REMOVE', c: item.currency, d: (-lineValue(item.priceMinor, item.quantity)).toString(), at: now }],
    });
  }
  if (targets.length) {
    log('item.deleted', targets.length === 1 ? `Moved "${targets[0]!.name}" to trash` : `Moved ${targets.length} items to trash`, targets.length === 1 ? targets[0]!.id : null);
  }
  return targets.length;
}

async function restore(ids: string[]): Promise<number> {
  const now = new Date().toISOString();
  const targets = ids.map((id) => store.items.get(id)).filter((item): item is StoredItem => Boolean(item?.deletedAt));
  for (const item of targets) {
    await store.saveItem({
      ...item,
      deletedAt: null,
      version: item.version + 1,
      events: [...item.events, { k: 'ADD', c: item.currency, d: lineValue(item.priceMinor, item.quantity).toString(), at: now }],
    });
  }
  if (targets.length) {
    log('item.restored', targets.length === 1 ? `Restored "${targets[0]!.name}"` : `Restored ${targets.length} items`, targets.length === 1 ? targets[0]!.id : null);
  }
  return targets.length;
}

async function purge(ids: string[]): Promise<number> {
  const targets = ids.map((id) => store.items.get(id)).filter((item): item is StoredItem => Boolean(item?.deletedAt));
  if (targets.length === 0) return 0;
  // Keep their value history so past totals stay correct.
  await store.archiveEvents(targets.flatMap((item) => item.events));
  for (const item of targets) await store.deleteItem(item.id);
  log('item.purged', targets.length === 1 ? `Permanently deleted "${targets[0]!.name}"` : `Permanently deleted ${targets.length} items`);
  return targets.length;
}

async function setCategory(ids: string[], categoryId: string | null): Promise<number> {
  assertCategory(categoryId);
  const now = new Date().toISOString();
  const targets = ids.map((id) => store.items.get(id)).filter((item): item is StoredItem => Boolean(item && !item.deletedAt));
  for (const item of targets) await store.saveItem({ ...item, categoryId, version: item.version + 1, updatedAt: now });
  if (targets.length) log('item.updated', `Changed the category of ${targets.length} item(s)`);
  return targets.length;
}

// ---------------------------------------------------------------- import

const HEADER_ALIASES: Record<string, string> = {
  name: 'name', item: 'name', 'item name': 'name', title: 'name',
  price: 'price', 'unit price': 'price', amount: 'price', cost: 'price',
  currency: 'currency', 'currency code': 'currency',
  quantity: 'quantity', qty: 'quantity',
  category: 'category',
  sku: 'sku', reference: 'sku', 'reference code': 'sku', ref: 'sku',
  description: 'description', notes: 'description',
  supplier: 'supplier', source: 'supplier', vendor: 'supplier',
  'purchase date': 'purchaseDate', purchased: 'purchaseDate',
  tags: 'tags',
};

async function importCsv(input: z.output<typeof importSchema>): Promise<ImportResultDTO> {
  let records: string[][];
  try {
    records = parseCsv(input.csv, IMPORT_MAX_ROWS_HERE + 1);
  } catch {
    throw new ApiError(422, 'VALIDATION_FAILED', 'The file could not be read as CSV.', { csv: 'The file could not be read as CSV' });
  }
  if (records.length < 2) throw new ApiError(422, 'VALIDATION_FAILED', 'The file needs a header row and at least one record.', { csv: 'No records found' });
  if (records.length > IMPORT_MAX_ROWS_HERE + 1) {
    throw new ApiError(422, 'VALIDATION_FAILED', `Import at most ${IMPORT_MAX_ROWS_HERE.toLocaleString('en-US')} rows per file in this edition.`, { csv: 'Too many rows' });
  }
  const columnFor = new Map<string, number>();
  records[0]!.forEach((raw, index) => {
    const field = HEADER_ALIASES[raw.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')];
    if (field && !columnFor.has(field)) columnFor.set(field, index);
  });
  if (!columnFor.has('name') || !columnFor.has('price')) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'The header row must include "name" and "price" columns.', { csv: 'Missing "name" or "price" column' });
  }

  const categoryByKey = new Map([...store.categories.values()].map((category) => [category.nameKey, category]));
  const newCategories = new Map<string, string>();
  const valid: { data: z.output<typeof createItemSchema>; categoryName: string | null }[] = [];
  const results: ImportRowResult[] = [];
  let invalidCount = 0;
  let reportedOk = 0;

  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    const cell = (field: string) => {
      const column = columnFor.get(field);
      return column === undefined ? '' : (record[column] ?? '').trim();
    };
    const errors: string[] = [];
    const quantityText = cell('quantity');
    const parsed = createItemSchema.safeParse({
      name: cell('name'),
      price: cell('price').replace(/^[₹$€£¥]\s*/u, ''),
      currency: cell('currency').toUpperCase() || input.defaultCurrency,
      quantity: quantityText === '' ? 1 : /^\d{1,7}$/.test(quantityText) ? Number(quantityText) : Number.NaN,
      sku: cell('sku'),
      description: cell('description'),
      supplier: cell('supplier'),
      purchaseDate: cell('purchaseDate'),
      tags: cell('tags').split(/[;|,]/).map((tag) => tag.trim()).filter(Boolean),
    });
    if (!parsed.success) {
      const seen = new Set<string>();
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.') || 'row';
        if (!seen.has(field)) {
          seen.add(field);
          errors.push(`${field}: ${issue.message}`);
        }
      }
    }
    let categoryName: string | null = null;
    const categoryText = cell('category');
    if (categoryText) {
      const category = categoryInputSchema.safeParse({ name: categoryText });
      if (!category.success) errors.push(`category: ${category.error.issues[0]?.message ?? 'Invalid category'}`);
      else {
        categoryName = category.data.name;
        const key = categoryName.toLowerCase();
        if (!categoryByKey.has(key)) {
          if (!input.createMissingCategories) errors.push(`category: "${categoryName}" does not exist`);
          else if (!newCategories.has(key)) newCategories.set(key, categoryName);
        }
      }
    }
    if (errors.length > 0 || !parsed.success) {
      invalidCount += 1;
      if (invalidCount <= 500) results.push({ row: rowNumber, status: 'error', errors, name: cell('name').slice(0, 120) || undefined });
      return;
    }
    valid.push({ data: parsed.data, categoryName });
    if (reportedOk < 50) {
      reportedOk += 1;
      results.push({ row: rowNumber, status: 'ok', name: parsed.data.name, price: parsed.data.price, currency: parsed.data.currency });
    }
  });

  const base: ImportResultDTO = {
    committed: false,
    totalRows: records.length - 1,
    validRows: valid.length,
    invalidRows: invalidCount,
    createdCount: 0,
    createdCategories: [...newCategories.values()],
    rows: results.sort((a, b) => a.row - b.row),
  };
  if (!input.commit || valid.length === 0) return base;

  await store.ensureProfile();
  const now = new Date().toISOString();
  for (const [nameKey, name] of newCategories) {
    const category: StoredCategory = { id: crypto.randomUUID(), name, nameKey, color: 'slate', createdAt: now, updatedAt: now };
    await store.saveCategory(category);
    categoryByKey.set(nameKey, category);
  }
  let created = 0;
  const BATCH = 5;
  for (let i = 0; i < valid.length; i += BATCH) {
    await Promise.all(
      valid.slice(i, i + BATCH).map(async ({ data, categoryName }) => {
        const categoryId = categoryName ? (categoryByKey.get(categoryName.toLowerCase())?.id ?? null) : null;
        await store.saveItem(newItem({ ...data, categoryId }, now, null));
        created += 1;
      }),
    );
  }
  log('data.imported', `Imported ${created} item(s) from CSV${invalidCount ? `, skipped ${invalidCount} invalid row(s)` : ''}`);
  await store.notify({
    kind: 'data',
    title: 'Import complete',
    body: `${created} item(s) were imported${invalidCount ? ` and ${invalidCount} invalid row(s) were skipped` : ''}.`,
    link: '/app/records',
  });
  return { ...base, committed: true, createdCount: created };
}

// ---------------------------------------------------------------- exports

const CSV_HEADER = [
  'Name', 'Unit price', 'Currency', 'Quantity', 'Line total', 'Category', 'SKU', 'Description', 'Supplier', 'Purchase date', 'Tags',
  'Created at (UTC)', 'Updated at (UTC)',
];

export async function buildExport(path: string, query: Query): Promise<{ filename: string; data: string }> {
  if (!(await store.ready())) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  const stamp = new Date().toISOString().slice(0, 10);
  if (path === '/api/data/account-export') {
    const items = [...store.items.values()];
    const payload = {
      exportedAt: new Date().toISOString(),
      account: userDTO(),
      categories: [...store.categories.values()].map(({ id, name, color, createdAt }) => ({ id, name, color, createdAt })),
      items: items.map((item) => ({ ...toItemDTO(item, store.categories), priceHistory: priceHistoryDTO(item) })),
      activity: (await store.activity()).slice(0, 5000).map(({ type, summary, createdAt }) => ({ type, summary, createdAt })),
    };
    log('data.exported', 'Downloaded a full account data export');
    return { filename: `vaultledger-account-${stamp}.json`, data: JSON.stringify(payload, null, 2) };
  }
  if (query.format === 'pdf') throw new ApiError(404, 'FEATURE_DISABLED', 'PDF export is available in the self-hosted edition. Use CSV here.');
  const list = parse(itemListQuerySchema, { ...query, page: 1, pageSize: 1 }, 'Invalid filter values');
  const rows = sortItems(filterItems(list), list.sort, list.order);
  let csv = '\uFEFF' + csvRow(CSV_HEADER);
  for (const item of rows) {
    const category = item.categoryId ? store.categories.get(item.categoryId) : undefined;
    csv += csvRow([
      item.name,
      minorToDecimalString(item.priceMinor, item.currency),
      item.currency,
      item.quantity,
      minorToDecimalString(lineValue(item.priceMinor, item.quantity), item.currency),
      category?.name ?? '',
      item.sku,
      item.description,
      item.supplier,
      item.purchaseDate,
      item.tags.join('; '),
      item.createdAt,
      item.updatedAt,
    ]);
  }
  log('data.exported', `Exported ${rows.length} record(s) as CSV`);
  return { filename: `vaultledger-records-${stamp}.csv`, data: csv };
}

// ---------------------------------------------------------------- routes

const ACTIVITY_SCOPES: Record<string, (type: string) => boolean> = {
  all: () => true,
  items: (type) => type.startsWith('item.') || type.startsWith('category.'),
  security: (type) => type.startsWith('auth.') || type.startsWith('account.'),
  data: (type) => type.startsWith('data.'),
};

function categoryDTO(category: StoredCategory): CategoryDTO {
  let count = 0;
  for (const item of store.items.values()) if (!item.deletedAt && item.categoryId === category.id) count += 1;
  return { id: category.id, name: category.name, color: category.color, itemCount: count, createdAt: category.createdAt, updatedAt: category.updatedAt };
}

async function saveCategoryInput(input: z.output<typeof categoryInputSchema>, existing?: StoredCategory): Promise<StoredCategory> {
  const nameKey = input.name.toLowerCase();
  for (const other of store.categories.values()) {
    if (other.nameKey === nameKey && other.id !== existing?.id) {
      throw new ApiError(409, 'CONFLICT', 'You already have a category with this name.', { name: 'You already have a category with this name' });
    }
  }
  if (!existing && store.categories.size >= CATEGORIES_PER_USER_MAX) {
    throw new ApiError(409, 'CONFLICT', `You can create up to ${CATEGORIES_PER_USER_MAX} categories.`);
  }
  const now = new Date().toISOString();
  const category: StoredCategory = existing
    ? { ...existing, name: input.name, nameKey, color: input.color, updatedAt: now }
    : { id: crypto.randomUUID(), name: input.name, nameKey, color: input.color, createdAt: now, updatedAt: now };
  await store.ensureProfile();
  await store.saveCategory(category);
  return category;
}

const ROUTES: [string, string, Handler][] = [
  ['GET', '/api/config', async () => {
    const data: PublicConfig = {
      appName: 'VaultLedger',
      features: { phoneAuth: false, emailDelivery: 'smtp', smsDelivery: 'disabled', pdfExport: false, breachedPasswordCheck: false },
      requirePhoneOnSignup: false,
      passwordMinLength: PASSWORD_MIN_LENGTH,
    };
    return { data };
  }],
  ['GET', '/api/auth/session', async () => ({ data: { user: (await store.ready()) ? userDTO() : null } })],
  ['POST', '/api/auth/logout', async () => ({ data: { ok: true } })],
  ['GET', '/api/account', async () => ({ data: userDTO() })],
  ['PATCH', '/api/account/settings', async ({ body }) => {
    const changes = parse(updateSettingsSchema, body);
    await store.saveProfile({ settings: { ...store.profile.settings, ...changes } });
    log('account.settings_updated', 'Preferences updated');
    return { data: userDTO() };
  }],
  ['DELETE', '/api/account', async ({ body }) => {
    parse(z.strictObject({ confirmation: z.literal(DELETE_CONFIRMATION_PHRASE, `Type "${DELETE_CONFIRMATION_PHRASE}" to confirm`) }), body);
    await store.deleteEverything();
    return { data: { message: 'All of your VaultLedger data has been permanently deleted.' } };
  }],

  ['GET', '/api/items', async ({ query }) => {
    const list = parse(itemListQuerySchema, query, 'Invalid filter values');
    const all = sortItems(filterItems(list), list.sort, list.order);
    const start = (list.page - 1) * list.pageSize;
    return {
      data: all.slice(start, start + list.pageSize).map((item) => toItemDTO(item, store.categories)),
      meta: { page: list.page, pageSize: list.pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / list.pageSize)) },
    };
  }],
  ['POST', '/api/items', async ({ body, headers }) => {
    const key = headers['Idempotency-Key'] ?? null;
    if (key) {
      const existing = [...store.items.values()].find((item) => item.clientRequestId === key);
      if (existing) return { data: toItemDTO(existing, store.categories) };
    }
    const data = parse(createItemSchema, body);
    assertCategory(data.categoryId);
    await store.ensureProfile();
    const item = newItem(data, new Date().toISOString(), key);
    await store.saveItem(item);
    log('item.created', `Added "${item.name}"`, item.id);
    return { data: toItemDTO(item, store.categories) };
  }],
  ['POST', '/api/items/bulk', async ({ body }) => {
    const input = parse(bulkActionSchema, body);
    const ids = [...new Set(input.ids)];
    let affected: number;
    if (input.action === 'setCategory') affected = await setCategory(ids, input.categoryId);
    else if (input.action === 'delete') affected = await softDelete(ids);
    else if (input.action === 'restore') affected = await restore(ids);
    else affected = await purge(ids);
    return { data: { affected } };
  }],
  ['GET', '/api/items/:id', async ({ params }) => {
    const item = store.items.get(params.id!);
    if (!item) throw notFound();
    return { data: { ...toItemDTO(item, store.categories), priceHistory: priceHistoryDTO(item) } };
  }],
  ['PATCH', '/api/items/:id', async ({ params, body }) => {
    const input = parse(updateItemSchema, body);
    const current = store.items.get(params.id!);
    if (!current || current.deletedAt) throw notFound();
    if (current.version !== input.version) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'This item was changed on another device. Reload it to see the latest version.');
    }
    const currency = input.currency ?? current.currency;
    let priceMinor = BigInt(current.priceMinor);
    if (input.price !== undefined) priceMinor = toMinor(input.price, currency);
    else if (currency !== current.currency) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Enter the price in the new currency', { price: 'Enter the price in the new currency' });
    }
    const quantity = input.quantity ?? current.quantity;
    if (input.categoryId !== undefined) assertCategory(input.categoryId);

    const next: StoredItem = { ...current };
    const changed: string[] = [];
    const change = <K extends keyof StoredItem>(key: K, value: StoredItem[K]) => {
      if (JSON.stringify(value) !== JSON.stringify(current[key])) {
        next[key] = value;
        changed.push(key);
      }
    };
    if (input.name !== undefined) change('name', input.name);
    change('priceMinor', priceMinor.toString());
    change('currency', currency);
    change('quantity', quantity);
    if (input.categoryId !== undefined) change('categoryId', input.categoryId);
    if (input.sku !== undefined) change('sku', input.sku);
    if (input.description !== undefined) change('description', input.description);
    if (input.supplier !== undefined) change('supplier', input.supplier);
    if (input.purchaseDate !== undefined) change('purchaseDate', input.purchaseDate || null);
    if (input.tags !== undefined) change('tags', input.tags);
    if (changed.length === 0) return { data: toItemDTO(current, store.categories) };

    const now = new Date().toISOString();
    next.version = current.version + 1;
    next.updatedAt = now;
    if (changed.some((key) => key === 'priceMinor' || key === 'currency' || key === 'quantity')) {
      next.history = [...current.history, { p: priceMinor.toString(), c: currency, q: quantity, at: now }];
      const before = lineValue(current.priceMinor, current.quantity);
      const after = lineValue(priceMinor, quantity);
      if (currency === current.currency) {
        if (before !== after) next.events = [...current.events, { k: 'REPRICE', c: currency, d: (after - before).toString(), at: now }];
      } else {
        next.events = [
          ...current.events,
          { k: 'REMOVE', c: current.currency, d: (-before).toString(), at: now },
          { k: 'ADD', c: currency, d: after.toString(), at: now },
        ];
      }
    }
    await store.saveItem(next);
    log('item.updated', `Updated ${changed.map((key) => FIELD_LABELS[key] ?? key).join(', ')} of "${next.name}"`, next.id);
    return { data: toItemDTO(next, store.categories) };
  }],
  ['DELETE', '/api/items/:id', async ({ params }) => {
    if ((await softDelete([params.id!])) === 0) throw notFound();
    return { data: { affected: 1 } };
  }],
  ['POST', '/api/items/:id/restore', async ({ params }) => {
    if ((await restore([params.id!])) === 0) throw notFound('Item in trash');
    return { data: { affected: 1 } };
  }],
  ['DELETE', '/api/items/:id/permanent', async ({ params }) => {
    if ((await purge([params.id!])) === 0) throw notFound('Item in trash');
    return { data: { affected: 1 } };
  }],

  ['GET', '/api/categories', async () => ({
    data: [...store.categories.values()].sort((a, b) => a.nameKey.localeCompare(b.nameKey)).map(categoryDTO),
  })],
  ['POST', '/api/categories', async ({ body }) => {
    const category = await saveCategoryInput(parse(categoryInputSchema, body));
    log('category.created', `Created category "${category.name}"`, category.id);
    return { data: categoryDTO(category) };
  }],
  ['PATCH', '/api/categories/:id', async ({ params, body }) => {
    const existing = store.categories.get(params.id!);
    if (!existing) throw notFound('Category');
    const category = await saveCategoryInput(parse(categoryInputSchema, body), existing);
    log('category.updated', `Updated category "${category.name}"`, category.id);
    return { data: categoryDTO(category) };
  }],
  ['DELETE', '/api/categories/:id', async ({ params }) => {
    const existing = store.categories.get(params.id!);
    if (!existing) throw notFound('Category');
    // Items keep existing and become uncategorised.
    for (const item of [...store.items.values()]) {
      if (item.categoryId === existing.id) await store.saveItem({ ...item, categoryId: null });
    }
    await store.deleteCategory(existing.id);
    log('category.deleted', `Deleted category "${existing.name}"`, existing.id);
    return { data: { ok: true } };
  }],

  ['GET', '/api/insights/overview', async () => ({
    data: computeOverview([...store.items.values()], store.categories, store.profile.settings.defaultCurrency),
  })],
  ['GET', '/api/insights/analytics', async ({ query }) => {
    const params = parse(analyticsQuerySchema, query, 'Invalid filter values');
    const tz = params.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    return {
      data: computeAnalytics([...store.items.values()], store.archive, store.categories, store.profile.settings.defaultCurrency, {
        ...params,
        tz,
      }),
    };
  }],
  ['GET', '/api/insights/activity', async ({ query }) => {
    const params = parse(activityQuerySchema, query);
    const entries = (await store.activity()).filter((entry) => (ACTIVITY_SCOPES[params.scope] ?? ACTIVITY_SCOPES.all!)(entry.type));
    const start = (params.page - 1) * params.pageSize;
    const data: ActivityDTO[] = entries.slice(start, start + params.pageSize).map((entry) => ({
      id: entry.id,
      type: entry.type as ActivityType,
      summary: entry.summary,
      entityId: entry.entityId,
      ipAddress: null,
      createdAt: entry.createdAt,
    }));
    return {
      data,
      meta: { page: params.page, pageSize: params.pageSize, total: entries.length, totalPages: Math.max(1, Math.ceil(entries.length / params.pageSize)) },
    };
  }],
  ['GET', '/api/insights/notifications', async () => {
    const data: NotificationDTO[] = store.profile.notifications;
    return { data, meta: { unread: data.filter((entry) => !entry.readAt).length } };
  }],
  ['POST', '/api/insights/notifications/read', async ({ body }) => {
    const input = parse(markNotificationsSchema, body);
    const now = new Date().toISOString();
    let updated = 0;
    const notifications = store.profile.notifications.map((entry) => {
      if (entry.readAt || (!input.all && !input.ids?.includes(entry.id))) return entry;
      updated += 1;
      return { ...entry, readAt: now };
    });
    if (updated) await store.saveProfile({ notifications });
    return { data: { updated } };
  }],
  ['POST', '/api/data/import', async ({ body }) => ({ data: await importCsv(parse(importSchema, body)) })],
];

const COMPILED = ROUTES.map(([method, pattern, handler]) => {
  const keys: string[] = [];
  const regex = new RegExp(
    `^${pattern.replace(/:([a-zA-Z]+)/g, (_match, key: string) => {
      keys.push(key);
      return '([^/]+)';
    })}$`,
  );
  return { method, regex, keys, handler };
});

const PUBLIC_ROUTES = new Set(['/api/config', '/api/auth/session', '/api/auth/logout']);

export async function handleLocal<T, M>(path: string, options: RequestOptions): Promise<ApiResponse<T, M>> {
  const method = options.method ?? 'GET';
  const route = COMPILED.map((entry) => ({ entry, match: entry.method === method ? entry.regex.exec(path) : null })).find(
    ({ match }) => match,
  );
  if (!route?.match) throw new ApiError(404, 'NOT_FOUND', 'This action is not available in this edition.');

  if (!PUBLIC_ROUTES.has(path) && !(await store.ready())) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  }

  const params: Record<string, string> = {};
  route.entry.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(route.match![index + 1]!);
  });
  const query: Query = {};
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') query[key] = String(value);
  }
  // Round-trip through JSON, exactly like a network request would.
  const body = options.body === undefined ? undefined : (JSON.parse(JSON.stringify(options.body)) as unknown);
  const result = await route.entry.handler({ params, query, body, headers: options.headers ?? {} });
  return result as ApiResponse<T, M>;
}

