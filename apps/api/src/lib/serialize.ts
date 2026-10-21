import type { Category, Item, PriceHistory, User } from '@prisma/client';
import {
  isCurrencyCode,
  minorToDecimalString,
  type CategoryColor,
  type CurrencyCode,
  type ItemDTO,
  type PriceHistoryEntryDTO,
  type SupportedLocale,
  type ThemePreference,
  type UserDTO,
} from '@vaultledger/shared';

export function asCurrency(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) throw new Error(`Unsupported currency stored: ${value}`);
  return value;
}

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    phone: user.phone ?? user.pendingPhone,
    phoneVerified: Boolean(user.phone && user.phoneVerifiedAt),
    pendingEmail: user.pendingEmail,
    createdAt: user.createdAt.toISOString(),
    settings: {
      defaultCurrency: asCurrency(user.defaultCurrency),
      theme: user.theme as ThemePreference,
      locale: user.locale as SupportedLocale,
      showQuantity: user.showQuantity,
    },
  };
}

export function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export type ItemWithCategory = Item & { category: Pick<Category, 'id' | 'name' | 'color'> | null };

export function toItemDTO(item: ItemWithCategory): ItemDTO {
  const currency = asCurrency(item.currency);
  return {
    id: item.id,
    name: item.name,
    price: minorToDecimalString(item.priceMinor, currency),
    priceMinor: item.priceMinor.toString(),
    currency,
    quantity: item.quantity,
    lineTotal: minorToDecimalString(item.priceMinor * BigInt(item.quantity), currency),
    category: item.category
      ? { id: item.category.id, name: item.category.name, color: item.category.color as CategoryColor }
      : null,
    sku: item.sku,
    description: item.description,
    supplier: item.supplier,
    purchaseDate: dateOnly(item.purchaseDate),
    tags: item.tags,
    version: item.version,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() ?? null,
  };
}

export function toPriceHistoryDTO(entry: PriceHistory): PriceHistoryEntryDTO {
  const currency = asCurrency(entry.currency);
  return {
    id: entry.id,
    price: minorToDecimalString(entry.priceMinor, currency),
    currency,
    quantity: entry.quantity,
    recordedAt: entry.recordedAt.toISOString(),
  };
}

export const categorySelect = { select: { id: true, name: true, color: true } } as const;
