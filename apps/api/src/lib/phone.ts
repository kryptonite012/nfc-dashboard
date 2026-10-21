import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { config } from '../config';
import { AppError } from './errors';

/** Parses user input into an E.164 phone number, or returns null if it is not a valid number. */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), config.DEFAULT_PHONE_REGION.toUpperCase() as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function requirePhone(input: string, field = 'phone'): string {
  const phone = normalizePhone(input);
  if (!phone) {
    throw new AppError('VALIDATION_FAILED', 'Enter a valid phone number', {
      [field]: 'Enter a valid phone number, including the country code',
    });
  }
  return phone;
}

export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}

/** Masks a phone number for display, e.g. +91•••••••210. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 6)}${phone.slice(-3)}`;
}
