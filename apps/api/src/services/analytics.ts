import { Prisma } from '@prisma/client';
import {
  currencyExponent,
  divideRounded,
  isCurrencyCode,
  minorToDecimalString,
  scaledToDecimalString,
  type AnalyticsDTO,
  type CategoryColor,
  type CurrencyCode,
  type CurrencySummary,
  type Granularity,
  type OverviewDTO,
} from '@vaultledger/shared';
import { prisma } from '../db';
import { categorySelect, toItemDTO } from '../lib/serialize';
import { addDays, resolveTimeZone, startOfDayInZone, todayInZone } from '../lib/time';

/** Converts a JS Date into a UTC `timestamp` literal comparable with Prisma's timestamp(3) columns. */
const ts = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Local bucket start (YYYY-MM-DD) of a UTC timestamp column in the given zone. */
const bucketOf = (column: Prisma.Sql, granularity: Granularity, tz: string) =>
  Prisma.sql`to_char(date_trunc(${granularity}, (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD')`;

const money = (value: string | bigint, currency: CurrencyCode) => scaledToDecimalString(BigInt(value), currencyExponent(currency));

export async function getOverview(userId: string, primaryCurrency: CurrencyCode): Promise<OverviewDTO> {
  const [totals, highest, recentlyAdded, recentlyUpdated, deletedCount, categoryCount] = await Promise.all([
    prisma.$queryRaw<{ currency: string; item_count: number; total_quantity: string; total_value: string; price_sum: string }[]>`
      SELECT currency,
             COUNT(*)::int AS item_count,
             COALESCE(SUM(quantity), 0)::text AS total_quantity,
             COALESCE(SUM(price_minor::numeric * quantity), 0)::text AS total_value,
             COALESCE(SUM(price_minor), 0)::text AS price_sum
        FROM items
       WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
       GROUP BY currency`,
    prisma.$queryRaw<{ id: string; name: string; currency: string; price_minor: string }[]>`
      SELECT DISTINCT ON (currency) id::text, name, currency, price_minor::text
        FROM items
       WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
       ORDER BY currency, price_minor DESC, created_at ASC`,
    prisma.item.findMany({
      where: { userId, deletedAt: null },
      include: { category: categorySelect },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
    }),
    prisma.item.findMany({
      where: { userId, deletedAt: null, version: { gt: 1 } },
      include: { category: categorySelect },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 5,
    }),
    prisma.item.count({ where: { userId, deletedAt: { not: null } } }),
    prisma.category.count({ where: { userId } }),
  ]);

  const highestByCurrency = new Map(highest.map((row) => [row.currency, row]));
  const currencies: CurrencySummary[] = totals
    .filter((row) => isCurrencyCode(row.currency))
    .map((row) => {
      const currency = row.currency as CurrencyCode;
      const top = highestByCurrency.get(row.currency);
      return {
        currency,
        itemCount: row.item_count,
        totalQuantity: Number(row.total_quantity),
        totalValue: money(row.total_value, currency),
        averagePrice: money(divideRounded(BigInt(row.price_sum), BigInt(row.item_count)), currency),
        highest: top ? { id: top.id, name: top.name, price: minorToDecimalString(top.price_minor, currency) } : null,
      };
    })
    .sort((a, b) => Number(b.currency === primaryCurrency) - Number(a.currency === primaryCurrency) || b.itemCount - a.itemCount);

  return {
    totalRecords: currencies.reduce((sum, entry) => sum + entry.itemCount, 0),
    primaryCurrency,
    currencies,
    recentlyAdded: recentlyAdded.map(toItemDTO),
    recentlyUpdated: recentlyUpdated.map(toItemDTO),
    deletedCount,
    categoryCount,
  };
}

/** Start of the bucket containing `isoDate` (weeks start on Monday, matching PostgreSQL's date_trunc). */
function alignToBucket(isoDate: string, granularity: Granularity): string {
  if (granularity === 'day') return isoDate;
  if (granularity === 'month') return `${isoDate.slice(0, 7)}-01`;
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, -((weekday + 6) % 7));
}

function nextBucket(isoDate: string, granularity: Granularity): string {
  if (granularity === 'day') return addDays(isoDate, 1);
  if (granularity === 'week') return addDays(isoDate, 7);
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

const DEFAULT_SPAN_DAYS: Record<Granularity, number> = { day: 29, week: 7 * 12 - 1, month: 365 };
const MAX_BUCKETS = 400;

export interface AnalyticsParams {
  from?: string;
  to?: string;
  granularity: Granularity;
  currency?: CurrencyCode;
  tz?: string;
}

export async function getAnalytics(userId: string, defaultCurrency: CurrencyCode, params: AnalyticsParams): Promise<AnalyticsDTO> {
  const tz = resolveTimeZone(params.tz);
  const { granularity } = params;
  const to = params.to ?? todayInZone(tz);
  const requestedFrom = params.from ?? addDays(to, -DEFAULT_SPAN_DAYS[granularity]);
  const from = alignToBucket(requestedFrom, granularity);

  const buckets: string[] = [];
  for (let bucket = from; bucket <= to && buckets.length < MAX_BUCKETS; bucket = nextBucket(bucket, granularity)) buckets.push(bucket);
  const rangeStart = startOfDayInZone(from, tz);
  const rangeEnd = startOfDayInZone(addDays(to, 1), tz);

  const currencyRows = await prisma.$queryRaw<{ currency: string }[]>`
    SELECT DISTINCT currency FROM value_ledger WHERE user_id = ${userId}::uuid
    UNION SELECT DISTINCT currency FROM items WHERE user_id = ${userId}::uuid`;
  const availableCurrencies = currencyRows.map((row) => row.currency).filter(isCurrencyCode).sort();
  const currency: CurrencyCode =
    params.currency ?? (availableCurrencies.includes(defaultCurrency) || availableCurrencies.length === 0 ? defaultCurrency : availableCurrencies[0]!);
  const exponent = currencyExponent(currency);
  const scale = 10n ** BigInt(exponent);

  const ledgerBucket = bucketOf(Prisma.raw('occurred_at'), granularity, tz);
  const itemBucket = bucketOf(Prisma.raw('created_at'), granularity, tz);

  const [opening, ledger, added, categories, bands, topItems, priceChanges] = await Promise.all([
    prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(delta_minor), 0)::text AS total FROM value_ledger
       WHERE user_id = ${userId}::uuid AND currency = ${currency} AND occurred_at < ${ts(rangeStart)}`,
    prisma.$queryRaw<{ bucket: string; kind: string; total: string }[]>`
      SELECT ${ledgerBucket} AS bucket, kind::text AS kind, SUM(delta_minor)::text AS total
        FROM value_ledger
       WHERE user_id = ${userId}::uuid AND currency = ${currency}
         AND occurred_at >= ${ts(rangeStart)} AND occurred_at < ${ts(rangeEnd)}
       GROUP BY 1, 2`,
    prisma.$queryRaw<{ bucket: string; count: number }[]>`
      SELECT ${itemBucket} AS bucket, COUNT(*)::int AS count
        FROM items
       WHERE user_id = ${userId}::uuid AND created_at >= ${ts(rangeStart)} AND created_at < ${ts(rangeEnd)}
       GROUP BY 1`,
    prisma.$queryRaw<{ id: string | null; name: string | null; color: string | null; count: number; value: string }[]>`
      SELECT c.id::text AS id, c.name, c.color, COUNT(i.id)::int AS count,
             COALESCE(SUM(i.price_minor::numeric * i.quantity) FILTER (WHERE i.currency = ${currency}), 0)::text AS value
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id
       WHERE i.user_id = ${userId}::uuid AND i.deleted_at IS NULL
       GROUP BY c.id, c.name, c.color
       ORDER BY count DESC, c.name ASC NULLS LAST`,
    prisma.$queryRaw<{ band: number; count: number }[]>`
      SELECT LEAST(CASE WHEN price_minor < ${10n * scale} THEN 0
                        ELSE floor(log(10, price_minor::numeric / ${scale.toString()}::numeric))::int END, 12) AS band,
             COUNT(*)::int AS count
        FROM items
       WHERE user_id = ${userId}::uuid AND deleted_at IS NULL AND currency = ${currency}
       GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ id: string; name: string; price_minor: string; quantity: number; line_total: string }[]>`
      SELECT id::text, name, price_minor::text, quantity, (price_minor::numeric * quantity)::text AS line_total
        FROM items
       WHERE user_id = ${userId}::uuid AND deleted_at IS NULL AND currency = ${currency}
       ORDER BY price_minor::numeric * quantity DESC, created_at ASC
       LIMIT 10`,
    prisma.$queryRaw<{ item_id: string; name: string; price_minor: string; prev_price: string; recorded_at: Date }[]>`
      SELECT item_id::text, name, price_minor::text, prev_price::text, recorded_at FROM (
        SELECT ph.item_id, i.name, ph.price_minor, ph.currency, ph.recorded_at,
               LAG(ph.price_minor) OVER w AS prev_price, LAG(ph.currency) OVER w AS prev_currency
          FROM price_history ph
          JOIN items i ON i.id = ph.item_id
         WHERE ph.user_id = ${userId}::uuid AND i.deleted_at IS NULL
        WINDOW w AS (PARTITION BY ph.item_id ORDER BY ph.recorded_at)
      ) history
       WHERE prev_price IS NOT NULL AND prev_currency = currency AND prev_price <> price_minor
         AND currency = ${currency} AND recorded_at >= ${ts(rangeStart)} AND recorded_at < ${ts(rangeEnd)}
       ORDER BY recorded_at DESC
       LIMIT 10`,
  ]);

  const byBucket = new Map<string, { ADD: bigint; REMOVE: bigint; REPRICE: bigint }>();
  for (const row of ledger) {
    const entry = byBucket.get(row.bucket) ?? { ADD: 0n, REMOVE: 0n, REPRICE: 0n };
    entry[row.kind as 'ADD' | 'REMOVE' | 'REPRICE'] += BigInt(row.total);
    byBucket.set(row.bucket, entry);
  }
  const addedByBucket = new Map(added.map((row) => [row.bucket, row.count]));

  let running = BigInt(opening[0]?.total ?? '0');
  const collectionValue: AnalyticsDTO['collectionValue'] = [];
  const valueChanges: AnalyticsDTO['valueChanges'] = [];
  for (const bucket of buckets) {
    const change = byBucket.get(bucket) ?? { ADD: 0n, REMOVE: 0n, REPRICE: 0n };
    running += change.ADD + change.REMOVE + change.REPRICE;
    collectionValue.push({ bucket, value: money(running, currency) });
    valueChanges.push({
      bucket,
      additions: money(change.ADD, currency),
      removals: money(change.REMOVE, currency),
      repricing: money(change.REPRICE, currency),
    });
  }

  const unit = (power: number) => (10n ** BigInt(power)).toLocaleString('en-US');
  const priceDistribution = bands.map((row) => ({
    label: row.band === 0 ? `Under ${unit(1)}` : row.band >= 12 ? `${unit(12)}+` : `${unit(row.band)} – ${unit(row.band + 1)}`,
    min: row.band === 0 ? '0' : (10n ** BigInt(row.band)).toString(),
    max: row.band >= 12 ? null : (10n ** BigInt(row.band + 1)).toString(),
    count: row.count,
  }));

  return {
    currency,
    availableCurrencies: availableCurrencies.length ? availableCurrencies : [currency],
    from,
    to,
    granularity,
    collectionValue,
    valueChanges,
    itemsAdded: buckets.map((bucket) => ({ bucket, count: addedByBucket.get(bucket) ?? 0 })),
    categoryDistribution: categories.map((row) => ({
      categoryId: row.id,
      name: row.name ?? 'Uncategorised',
      color: (row.color as CategoryColor | null) ?? null,
      count: row.count,
      value: money(row.value, currency),
    })),
    priceDistribution,
    topItems: topItems.map((row) => ({
      id: row.id,
      name: row.name,
      price: money(row.price_minor, currency),
      quantity: row.quantity,
      lineTotal: money(row.line_total, currency),
    })),
    priceChanges: priceChanges.map((row) => ({
      itemId: row.item_id,
      name: row.name,
      from: money(row.prev_price, currency),
      to: money(row.price_minor, currency),
      changedAt: row.recorded_at.toISOString(),
    })),
  };
}
