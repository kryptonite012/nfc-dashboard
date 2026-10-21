import type { CurrencyCode } from './currencies';
import type { ActivityType, CategoryColor, Granularity, SupportedLocale, ThemePreference } from './schemas/misc';

/** Every successful JSON response is wrapped as `{ data, meta? }`. */
export interface ApiSuccess<T, M = undefined> {
  data: T;
  meta?: M;
}

/** Every error response is wrapped as `{ error }`. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level validation messages keyed by dotted path. */
    fields?: Record<string, string>;
    requestId?: string;
  };
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'REAUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'CSRF_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'FEATURE_DISABLED'
  | 'WEAK_PASSWORD'
  | 'INVALID_CODE'
  | 'INTERNAL';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicConfig {
  appName: string;
  features: {
    phoneAuth: boolean;
    emailDelivery: 'smtp' | 'outbox';
    smsDelivery: 'twilio' | 'outbox' | 'disabled';
    pdfExport: boolean;
    breachedPasswordCheck: boolean;
  };
  requirePhoneOnSignup: boolean;
  passwordMinLength: number;
}

export interface UserSettings {
  defaultCurrency: CurrencyCode;
  theme: ThemePreference;
  locale: SupportedLocale;
  showQuantity: boolean;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  pendingEmail: string | null;
  createdAt: string;
  settings: UserSettings;
}

export interface SessionDTO {
  id: string;
  current: boolean;
  userAgent: string | null;
  browser: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  persistent: boolean;
}

export interface CategoryDTO {
  id: string;
  name: string;
  color: CategoryColor;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemDTO {
  id: string;
  name: string;
  /** Unit price as an exact decimal string, e.g. "1299.50". */
  price: string;
  /** Unit price in integer minor units, as a string. */
  priceMinor: string;
  currency: CurrencyCode;
  quantity: number;
  /** price × quantity as an exact decimal string. */
  lineTotal: string;
  category: { id: string; name: string; color: CategoryColor } | null;
  sku: string | null;
  description: string | null;
  supplier: string | null;
  purchaseDate: string | null;
  tags: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PriceHistoryEntryDTO {
  id: string;
  price: string;
  currency: CurrencyCode;
  quantity: number;
  recordedAt: string;
}

export interface ItemDetailDTO extends ItemDTO {
  priceHistory: PriceHistoryEntryDTO[];
}

/** Monetary totals are reported per currency; amounts in different currencies are never added together. */
export interface CurrencySummary {
  currency: CurrencyCode;
  itemCount: number;
  totalQuantity: number;
  /** Σ(unit price × quantity) over active records. */
  totalValue: string;
  /** Mean unit price, rounded half away from zero to the currency's minor unit. */
  averagePrice: string;
  highest: { id: string; name: string; price: string } | null;
}

export interface OverviewDTO {
  totalRecords: number;
  primaryCurrency: CurrencyCode;
  currencies: CurrencySummary[];
  recentlyAdded: ItemDTO[];
  recentlyUpdated: ItemDTO[];
  deletedCount: number;
  categoryCount: number;
}

export interface TimeSeriesPoint {
  /** Bucket start date, YYYY-MM-DD (UTC). */
  bucket: string;
  value: string;
}

export interface AnalyticsDTO {
  currency: CurrencyCode;
  availableCurrencies: CurrencyCode[];
  from: string;
  to: string;
  granularity: Granularity;
  /** Value of the collection at the end of each bucket (reconstructed from the value ledger). */
  collectionValue: TimeSeriesPoint[];
  /** Net change in collection value within each bucket, split by cause. */
  valueChanges: { bucket: string; additions: string; removals: string; repricing: string }[];
  itemsAdded: { bucket: string; count: number }[];
  categoryDistribution: { categoryId: string | null; name: string; color: CategoryColor | null; count: number; value: string }[];
  priceDistribution: { label: string; min: string; max: string | null; count: number }[];
  topItems: { id: string; name: string; price: string; quantity: number; lineTotal: string }[];
  priceChanges: { itemId: string; name: string; from: string; to: string; changedAt: string }[];
}

export interface ActivityDTO {
  id: string;
  type: ActivityType;
  summary: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  kind: 'security' | 'data' | 'account';
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ImportRowResult {
  row: number;
  status: 'ok' | 'error';
  errors?: string[];
  name?: string;
  price?: string;
  currency?: CurrencyCode;
}

export interface ImportResultDTO {
  committed: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdCount: number;
  createdCategories: string[];
  rows: ImportRowResult[];
}
