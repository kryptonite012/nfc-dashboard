import { describe, expect, it } from 'vitest';
import { formatMoney } from './format';
import { safeNextPath } from './utils';

describe('safeNextPath', () => {
  it('allows in-app paths', () => {
    expect(safeNextPath('/app/records?q=desk')).toBe('/app/records?q=desk');
    expect(safeNextPath('/app')).toBe('/app');
  });

  it.each([
    'https://evil.example/app',
    '//evil.example/app',
    '/\\evil.example',
    '/app\\..\\evil',
    'javascript:alert(1)',
    '/login',
    '',
    null,
  ])('rejects %s', (value) => {
    expect(safeNextPath(value)).toBe('/app');
  });
});

describe('formatMoney', () => {
  it('formats exact decimal strings with the currency’s precision', () => {
    expect(formatMoney('1234567.5', 'INR', 'en-IN')).toBe('₹12,34,567.50');
    expect(formatMoney('1500', 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatMoney('1.234', 'KWD', 'en-US')).toMatch(/1\.234/);
  });

  it('does not lose precision on very large amounts', () => {
    expect(formatMoney('999999999999990000.30', 'USD', 'en-US')).toBe('$999,999,999,999,990,000.30');
  });
});
