import {
  currencyExponent,
  divideRounded,
  minorToDecimalString,
  scaledToDecimalString,
  type AnalyticsDTO,
  type CurrencyCode,
  type CurrencySummary,
  type Granularity,
  type ItemDTO,
  type OverviewDTO,
  type PriceHistoryEntryDTO,
} from '@vaultledger/shared';
import type { StoredCategory, StoredEvent, StoredItem } from './store';

/**
 * Pure calculations for the Claude edition, mirroring the server's SQL so both
 * editions report identical figures. All money arithmetic uses BigInt minor units.
 */

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date (YYYY-MM-DD) of an instant in the given time zone. */
export function localDate(iso: string, tz: string): string {
  let formatter = dayFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(tz, formatter);
  }
  return formatter.format(new Date(iso));
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function alignToBucket(isoDate: string, granularity: Granularity): string {
  if (granularity === 'day') return isoDate;
  if (granularity === 'month') return `${isoDate.slice(0, 7)}-01`;
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return addDays(isoDate, -((weekday + 6) % 7));
}

function nextBucket(isoDate: string, granularity: Granularity): string {
  if (granularity === 'day') return addDays(isoDate, 1);
  if (granularity === 'week') return addDays(isoDate, 7);
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

const money = (value: bigint, currency: CurrencyCode) => scaledToDecimalString(value, currencyExponent(currency));

export function toItemDTO(item: StoredItem, categories: Map<string, StoredCategory>): ItemDTO {
  const category = item.categoryId ? categories.get(item.categoryId) : undefined;
  const priceMinor = BigInt(item.priceMinor);
  return {
    id: item.id,
    name: item.name,
    price: minorToDecimalString(priceMinor, item.currency),
    priceMinor: item.priceMinor,
    currency: item.currency,
    quantity: item.quantity,
    lineTotal: minorToDecimalString(priceMinor * BigInt(item.quantity), item.currency),
    category: category ? { id: category.id, name: category.name, color: category.color } : null,
    sku: item.sku,
    description: item.description,
    supplier: item.supplier,
    purchaseDate: item.purchaseDate,
    tags: item.tags,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  };
}

export function priceHistoryDTO(item: StoredItem): PriceHistoryEntryDTO[] {
  return item.history
    .map((entry, index) => ({
      id: `${item.id}-${index}`,
      price: minorToDecimalString(BigInt(entry.p), entry.c),
      currency: entry.c,
      quantity: entry.q,
      recordedAt: entry.at,
    }))
    .reverse();
}

export function computeOverview(
  items: StoredItem[],
  categories: Map<string, StoredCategory>,
  primaryCurrency: CurrencyCode,
): OverviewDTO {
  const active = items.filter((item) => !item.deletedAt);
  const groups = new Map<CurrencyCode, StoredItem[]>();
  for (const item of active) groups.set(item.currency, [...(groups.get(item.currency) ?? []), item]);

  const currencies: CurrencySummary[] = [...groups.entries()]
    .map(([currency, group]) => {
      let totalValue = 0n;
      let priceSum = 0n;
      let totalQuantity = 0;
      let highest: StoredItem | null = null;
      for (const item of group) {
        const price = BigInt(item.priceMinor);
        totalValue += price * BigInt(item.quantity);
        priceSum += price;
        totalQuantity += item.quantity;
        if (
          !highest ||
          price > BigInt(highest.priceMinor) ||
          (price === BigInt(highest.priceMinor) && item.createdAt < highest.createdAt)
        ) {
          highest = item;
        }
      }
      return {
        currency,
        itemCount: group.length,
        totalQuantity,
        totalValue: money(totalValue, currency),
        averagePrice: money(divideRounded(priceSum, BigInt(group.length)), currency),
        highest: highest ? { id: highest.id, name: highest.name, price: minorToDecimalString(highest.priceMinor, currency) } : null,
      };
    })
    .sort((a, b) => Number(b.currency === primaryCurrency) - Number(a.currency === primaryCurrency) || b.itemCount - a.itemCount);

  const byNewest = (field: 'createdAt' | 'updatedAt') => (a: StoredItem, b: StoredItem) =>
    b[field].localeCompare(a[field]) || b.id.localeCompare(a.id);

  return {
    totalRecords: active.length,
    primaryCurrency,
    currencies,
    recentlyAdded: [...active].sort(byNewest('createdAt')).slice(0, 5).map((item) => toItemDTO(item, categories)),
    recentlyUpdated: active
      .filter((item) => item.version > 1)
      .sort(byNewest('updatedAt'))
      .slice(0, 5)
      .map((item) => toItemDTO(item, categories)),
    deletedCount: items.length - active.length,
    categoryCount: categories.size,
  };
}

const DEFAULT_SPAN_DAYS: Record<Granularity, number> = { day: 29, week: 7 * 12 - 1, month: 365 };
const MAX_BUCKETS = 400;

export function computeAnalytics(
  items: StoredItem[],
  archive: StoredEvent[],
  categories: Map<string, StoredCategory>,
  defaultCurrency: CurrencyCode,
  params: { from?: string; to?: string; granularity: Granularity; currency?: CurrencyCode; tz: string },
): AnalyticsDTO {
  const { granularity, tz } = params;
  const to = params.to ?? localDate(new Date().toISOString(), tz);
  const from = alignToBucket(params.from ?? addDays(to, -DEFAULT_SPAN_DAYS[granularity]), granularity);

  const buckets: string[] = [];
  for (let bucket = from; bucket <= to && buckets.length < MAX_BUCKETS; bucket = nextBucket(bucket, granularity)) buckets.push(bucket);

  const events = [...items.flatMap((item) => item.events), ...archive];
  const available = [...new Set([...events.map((event) => event.c), ...items.map((item) => item.currency)])].sort();
  const currency: CurrencyCode =
    params.currency ?? (available.includes(defaultCurrency) || available.length === 0 ? defaultCurrency : available[0]!);
  const scale = 10n ** BigInt(currencyExponent(currency));

  // Collection value and its changes, from the value events.
  let running = 0n;
  const changes = new Map<string, { ADD: bigint; REMOVE: bigint; REPRICE: bigint }>();
  for (const event of events) {
    if (event.c !== currency) continue;
    const day = localDate(event.at, tz);
    if (day < from) {
      running += BigInt(event.d);
      continue;
    }
    if (day > to) continue;
    const bucket = alignToBucket(day, granularity);
    const entry = changes.get(bucket) ?? { ADD: 0n, REMOVE: 0n, REPRICE: 0n };
    entry[event.k] += BigInt(event.d);
    changes.set(bucket, entry);
  }
  const collectionValue: AnalyticsDTO['collectionValue'] = [];
  const valueChanges: AnalyticsDTO['valueChanges'] = [];
  for (const bucket of buckets) {
    const change = changes.get(bucket) ?? { ADD: 0n, REMOVE: 0n, REPRICE: 0n };
    running += change.ADD + change.REMOVE + change.REPRICE;
    collectionValue.push({ bucket, value: money(running, currency) });
    valueChanges.push({
      bucket,
      additions: money(change.ADD, currency),
      removals: money(change.REMOVE, currency),
      repricing: money(change.REPRICE, currency),
    });
  }

  // Items added per bucket (all currencies, including records now in the trash).
  const added = new Map<string, number>();
  for (const item of items) {
    const day = localDate(item.createdAt, tz);
    if (day < from || day > to) continue;
    const bucket = alignToBucket(day, granularity);
    added.set(bucket, (added.get(bucket) ?? 0) + 1);
  }

  const active = items.filter((item) => !item.deletedAt);
  const inCurrency = active.filter((item) => item.currency === currency);
  const lineTotal = (item: StoredItem) => BigInt(item.priceMinor) * BigInt(item.quantity);

  // Category distribution.
  const byCategory = new Map<string | null, { count: number; value: bigint }>();
  for (const item of active) {
    const key = item.categoryId && categories.has(item.categoryId) ? item.categoryId : null;
    const entry = byCategory.get(key) ?? { count: 0, value: 0n };
    entry.count += 1;
    if (item.currency === currency) entry.value += lineTotal(item);
    byCategory.set(key, entry);
  }
  const categoryDistribution = [...byCategory.entries()]
    .map(([id, entry]) => {
      const category = id ? categories.get(id) : undefined;
      return {
        categoryId: id,
        name: category?.name ?? 'Uncategorised',
        color: category?.color ?? null,
        count: entry.count,
        value: money(entry.value, currency),
      };
    })
    .sort((a, b) => b.count - a.count || (a.categoryId === null ? 1 : b.categoryId === null ? -1 : a.name.localeCompare(b.name)));

  // Unit-price bands by order of magnitude of the major unit.
  const bands = new Map<number, number>();
  for (const item of inCurrency) {
    const major = BigInt(item.priceMinor) / scale;
    const band = major < 10n ? 0 : Math.min(major.toString().length - 1, 12);
    bands.set(band, (bands.get(band) ?? 0) + 1);
  }
  const unit = (power: number) => (10n ** BigInt(power)).toLocaleString('en-US');
  const priceDistribution = [...bands.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([band, count]) => ({
      label: band === 0 ? `Under ${unit(1)}` : band >= 12 ? `${unit(12)}+` : `${unit(band)} – ${unit(band + 1)}`,
      min: band === 0 ? '0' : (10n ** BigInt(band)).toString(),
      max: band >= 12 ? null : (10n ** BigInt(band + 1)).toString(),
      count,
    }));

  const topItems = [...inCurrency]
    .sort((a, b) => {
      const diff = lineTotal(b) - lineTotal(a);
      return diff > 0n ? 1 : diff < 0n ? -1 : a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: minorToDecimalString(item.priceMinor, currency),
      quantity: item.quantity,
      lineTotal: money(lineTotal(item), currency),
    }));

  const priceChanges = active
    .flatMap((item) =>
      item.history.slice(1).flatMap((entry, index) => {
        const previous = item.history[index]!;
        const day = localDate(entry.at, tz);
        if (previous.c !== entry.c || previous.p === entry.p || entry.c !== currency || day < from || day > to) return [];
        return [{ itemId: item.id, name: item.name, from: money(BigInt(previous.p), currency), to: money(BigInt(entry.p), currency), changedAt: entry.at }];
      }),
    )
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    .slice(0, 10);

  return {
    currency,
    availableCurrencies: available.length ? available : [currency],
    from,
    to,
    granularity,
    collectionValue,
    valueChanges,
    itemsAdded: buckets.map((bucket) => ({ bucket, count: added.get(bucket) ?? 0 })),
    categoryDistribution,
    priceDistribution,
    topItems,
    priceChanges,
  };
}
