import { describe, expect, it } from 'vitest';
import { decimalStringToMinor, divideRounded, minorToDecimalString, parseMoney, scaledToDecimalString } from './money';
import { createItemSchema, itemFormSchema } from './schemas/items';
import { changePasswordSchema, registerSchema } from './schemas/auth';

describe('parseMoney', () => {
  it.each([
    ['0', 'INR', 0n],
    ['10', 'INR', 1000n],
    ['10.5', 'INR', 1050n],
    ['1,299.99', 'INR', 129999n],
    [' 1_000 ', 'USD', 100000n],
    ['0.10', 'USD', 10n],
    ['1500', 'JPY', 1500n],
    ['1.234', 'KWD', 1234n],
    ['999999999999.99', 'INR', 99999999999999n],
  ] as const)('parses %s %s exactly', (input, currency, expected) => {
    expect(parseMoney(input, currency)).toEqual({ ok: true, minor: expected });
  });

  it.each([
    ['', 'format'],
    ['-1', 'format'],
    ['1e3', 'format'],
    ['NaN', 'format'],
    ['Infinity', 'format'],
    ['1.2.3', 'format'],
    ['0x10', 'format'],
    ['12.345', 'precision'],
    ['1000000000000', 'range'],
  ] as const)('rejects %s for INR (%s)', (input, error) => {
    expect(parseMoney(input, 'INR')).toEqual({ ok: false, error });
  });

  it('respects zero-decimal currencies', () => {
    expect(parseMoney('10.5', 'JPY')).toEqual({ ok: false, error: 'precision' });
  });
});

describe('decimal conversion', () => {
  it('round-trips without floating-point error', () => {
    const sum = decimalStringToMinor('0.10', 'USD') + decimalStringToMinor('0.20', 'USD');
    expect(minorToDecimalString(sum, 'USD')).toBe('0.30');
  });

  it('formats scaled values of any size', () => {
    expect(scaledToDecimalString(5n, 2)).toBe('0.05');
    expect(scaledToDecimalString(-12345n, 2)).toBe('-123.45');
    expect(scaledToDecimalString(99999999999999000000n, 2)).toBe('999999999999990000.00');
    expect(minorToDecimalString('1500', 'JPY')).toBe('1500');
  });

  it('rounds averages half away from zero', () => {
    expect(divideRounded(10n, 4n)).toBe(3n); // 2.5 -> 3
    expect(divideRounded(10n, 3n)).toBe(3n);
    expect(divideRounded(-10n, 4n)).toBe(-3n);
    expect(() => divideRounded(1n, 0n)).toThrow(RangeError);
  });
});

describe('item schemas', () => {
  it('normalises optional fields and tags', () => {
    const parsed = createItemSchema.parse({
      name: '  Lamp ',
      price: '10',
      currency: 'INR',
      sku: '',
      description: '',
      tags: ['Home', 'home', 'Office'],
    });
    expect(parsed).toMatchObject({ name: 'Lamp', quantity: 1, sku: null, description: null, categoryId: null, tags: ['home', 'office'] });
  });

  it('rejects unknown keys and control characters', () => {
    expect(createItemSchema.safeParse({ name: 'A', price: '1', currency: 'INR', owner: 'x' }).success).toBe(false);
    expect(createItemSchema.safeParse({ name: 'A\u0000B', price: '1', currency: 'INR' }).success).toBe(false);
  });

  it('validates form values as strings', () => {
    const base = {
      name: 'Pen',
      price: '10',
      currency: 'INR' as const,
      quantity: '2',
      categoryId: '',
      sku: '',
      description: '',
      supplier: '',
      purchaseDate: '',
      tags: 'a, b',
    };
    expect(itemFormSchema.safeParse(base).success).toBe(true);
    expect(itemFormSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...base, quantity: '1.5' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...base, purchaseDate: '2026-02-30' }).success).toBe(false);
  });
});

describe('auth schemas', () => {
  const valid = {
    name: 'Asha',
    email: ' Asha@Example.COM ',
    password: 'violet-Harbor-telescope-91',
    confirmPassword: 'violet-Harbor-telescope-91',
    acceptTerms: true,
  };

  it('normalises the email address', () => {
    expect(registerSchema.parse(valid).email).toBe('asha@example.com');
  });

  it('reports a password mismatch even when other fields are invalid', () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'different', acceptTerms: false });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['confirmPassword', 'acceptTerms']));
  });

  it('requires a different new password', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: valid.password,
      newPassword: valid.password,
      confirmPassword: valid.password,
    });
    expect(result.success).toBe(false);
  });
});
