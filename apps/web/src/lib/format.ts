import { CURRENCIES, currencyExponent, type CurrencyCode, type SupportedLocale } from '@vaultledger/shared';

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let cached = formatterCache.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, cached);
  }
  return cached;
}

/**
 * Formats an exact decimal string (as returned by the API) as currency.
 * Modern Intl.NumberFormat accepts decimal strings and formats them exactly,
 * so no floating-point conversion is involved.
 */
export function formatMoney(amount: string, currency: CurrencyCode, locale: SupportedLocale | string = 'en-IN'): string {
  const digits = currencyExponent(currency);
  return formatter(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount as unknown as number);
}

/** Compact currency (₹1.2L / $4.2K) for chart axes and stat tiles. Display only. */
export function formatMoneyCompact(amount: number, currency: CurrencyCode, locale: SupportedLocale | string = 'en-IN'): string {
  return formatter(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount);
}

export function formatNumber(value: number, locale: SupportedLocale | string = 'en-IN'): string {
  return formatter(locale, {}).format(value);
}

export function currencySymbol(currency: CurrencyCode, locale: SupportedLocale | string = 'en-IN'): string {
  return (
    formatter(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}

export function currencyLabel(currency: CurrencyCode): string {
  return `${currency} — ${CURRENCIES[currency].name}`;
}

export function formatDate(iso: string, locale: SupportedLocale | string = 'en-IN'): string {
  return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string, locale: SupportedLocale | string = 'en-IN'): string {
  return new Date(iso).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Calendar-only dates (YYYY-MM-DD) are formatted without shifting time zones. */
export function formatCalendarDate(isoDate: string, locale: SupportedLocale | string = 'en-IN'): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatBucket(isoDate: string, granularity: 'day' | 'week' | 'month', locale: SupportedLocale | string = 'en-IN'): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (granularity === 'month') return date.toLocaleDateString(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelative(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), 'day');
  return formatDate(iso);
}

export function formatCount(count: number, singular: string, plural = `${singular}s`, locale: SupportedLocale | string = 'en-IN'): string {
  return `${formatNumber(count, locale)} ${count === 1 ? singular : plural}`;
}

/** True for exact decimal strings equal to zero ("0", "0.00", "-0.000"). */
export function isZeroAmount(decimal: string): boolean {
  return /^-?0+(\.0+)?$/.test(decimal);
}
