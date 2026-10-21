import { currencyExponent, type CurrencyCode } from './currencies';

/** Largest accepted unit price, in major units (just under one trillion). */
export const MAX_PRICE_MAJOR = 999_999_999_999n;

const DECIMAL_PATTERN = /^(\d{1,15})(?:\.(\d{1,3}))?$/;

export type MoneyParseError = 'format' | 'precision' | 'range';

export type MoneyParseResult =
  | { ok: true; minor: bigint }
  | { ok: false; error: MoneyParseError };

/**
 * Parses a user-entered decimal amount (e.g. "1,299.50") into integer minor
 * units for the given currency without using floating-point numbers.
 * Grouping commas, underscores and surrounding whitespace are ignored.
 * Negative values, exponents and more decimals than the currency allows are rejected.
 */
export function parseMoney(input: string, currency: CurrencyCode): MoneyParseResult {
  const normalized = input.trim().replace(/[,_\s]/g, '');
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return { ok: false, error: 'format' };

  const exponent = currencyExponent(currency);
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) return { ok: false, error: 'precision' };

  const wholeValue = BigInt(whole);
  if (wholeValue > MAX_PRICE_MAJOR) return { ok: false, error: 'range' };

  const minor = wholeValue * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, '0') || '0');
  return { ok: true, minor };
}

/** Converts integer minor units into a plain decimal string ("123450" INR -> "1234.50"). */
export function minorToDecimalString(minor: bigint | string, currency: CurrencyCode): string {
  return scaledToDecimalString(BigInt(minor), currencyExponent(currency));
}

/** Formats a scaled integer as a decimal string with the given number of fraction digits. */
export function scaledToDecimalString(value: bigint, exponent: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(-exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Inverse of {@link minorToDecimalString}; throws on malformed input. Intended for trusted values. */
export function decimalStringToMinor(value: string, currency: CurrencyCode): bigint {
  const negative = value.startsWith('-');
  const result = parseMoney(negative ? value.slice(1) : value, currency);
  if (!result.ok) throw new Error(`Invalid decimal amount for ${currency}`);
  return negative ? -result.minor : result.minor;
}

/**
 * Divides a scaled integer and rounds half away from zero. Used for averages
 * so that results stay exact integers in minor units.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (2n * d);
  return negative ? -quotient : quotient;
}
