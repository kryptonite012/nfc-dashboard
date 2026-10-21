/**
 * Supported ISO 4217 currencies and the number of minor-unit digits each uses.
 * Monetary values are always stored as integer minor units (e.g. paise, cents)
 * so that no floating-point arithmetic is ever applied to money.
 */
export const CURRENCIES = {
  INR: { name: 'Indian Rupee', exponent: 2 },
  USD: { name: 'US Dollar', exponent: 2 },
  EUR: { name: 'Euro', exponent: 2 },
  GBP: { name: 'British Pound', exponent: 2 },
  JPY: { name: 'Japanese Yen', exponent: 0 },
  CNY: { name: 'Chinese Yuan', exponent: 2 },
  AUD: { name: 'Australian Dollar', exponent: 2 },
  CAD: { name: 'Canadian Dollar', exponent: 2 },
  CHF: { name: 'Swiss Franc', exponent: 2 },
  SGD: { name: 'Singapore Dollar', exponent: 2 },
  HKD: { name: 'Hong Kong Dollar', exponent: 2 },
  NZD: { name: 'New Zealand Dollar', exponent: 2 },
  AED: { name: 'UAE Dirham', exponent: 2 },
  SAR: { name: 'Saudi Riyal', exponent: 2 },
  KWD: { name: 'Kuwaiti Dinar', exponent: 3 },
  BHD: { name: 'Bahraini Dinar', exponent: 3 },
  OMR: { name: 'Omani Rial', exponent: 3 },
  QAR: { name: 'Qatari Riyal', exponent: 2 },
  SEK: { name: 'Swedish Krona', exponent: 2 },
  NOK: { name: 'Norwegian Krone', exponent: 2 },
  DKK: { name: 'Danish Krone', exponent: 2 },
  ZAR: { name: 'South African Rand', exponent: 2 },
  BRL: { name: 'Brazilian Real', exponent: 2 },
  MXN: { name: 'Mexican Peso', exponent: 2 },
  KRW: { name: 'South Korean Won', exponent: 0 },
  THB: { name: 'Thai Baht', exponent: 2 },
  MYR: { name: 'Malaysian Ringgit', exponent: 2 },
  IDR: { name: 'Indonesian Rupiah', exponent: 2 },
  PHP: { name: 'Philippine Peso', exponent: 2 },
  PKR: { name: 'Pakistani Rupee', exponent: 2 },
  BDT: { name: 'Bangladeshi Taka', exponent: 2 },
  LKR: { name: 'Sri Lankan Rupee', exponent: 2 },
  NPR: { name: 'Nepalese Rupee', exponent: 2 },
} as const satisfies Record<string, { name: string; exponent: 0 | 2 | 3 }>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];

export const DEFAULT_CURRENCY: CurrencyCode = 'INR';

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function currencyExponent(code: CurrencyCode): number {
  return CURRENCIES[code].exponent;
}
