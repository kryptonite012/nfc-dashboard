import type { ApiErrorBody, ApiErrorCode } from '@vaultledger/shared';
import { IS_CLAUDE_EDITION } from './edition';
import type { DownloadsNs } from './local/claude';

/** Base URL of the API. Empty means same origin (recommended; the dev server proxies /api). */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    readonly fields: Record<string, string> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown, code?: ApiError['code']): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

// The CSRF token is held in memory only (never in localStorage).
let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfRequest ??= fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include', headers: { Accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, 'CSRF_FAILED', 'Could not start a secure session. Please reload the page.');
      const body = (await res.json()) as { data: { csrfToken: string } };
      csrfToken = body.data.csrfToken;
      return csrfToken;
    })
    .finally(() => {
      csrfRequest = null;
    });
  return csrfRequest;
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ApiResponse<T, M = unknown> {
  data: T;
  meta?: M;
}

/** Listeners notified when the server reports that the session is no longer valid. */
const unauthenticatedListeners = new Set<() => void>();
export function onUnauthenticated(listener: () => void) {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_BASE}${path}${search ? `?${search}` : ''}`;
}

async function send(path: string, options: RequestOptions, retried = false): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await getCsrfToken();
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }

  if (response.status === 403 && !retried && method !== 'GET') {
    const body = (await response.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error.code === 'CSRF_FAILED') {
      csrfToken = null;
      return send(path, options, true);
    }
  }
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  if (response.status === 401 && body?.error.code === 'UNAUTHENTICATED') {
    unauthenticatedListeners.forEach((listener) => listener());
  }
  return new ApiError(
    response.status,
    body?.error.code ?? 'INTERNAL',
    body?.error.message ?? `Request failed (${response.status})`,
    body?.error.fields,
    body?.error.requestId,
  );
}

export async function api<T, M = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T, M>> {
  if (IS_CLAUDE_EDITION) {
    const { handleLocal } = await import('./local/backend');
    return handleLocal<T, M>(path, options);
  }
  const response = await send(path, options);
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as ApiResponse<T, M>;
}

/** Downloads a file response (CSV, PDF, JSON export) without exposing credentials in a URL. */
export async function downloadFile(path: string, query: Record<string, QueryValue>, fallbackName: string): Promise<void> {
  if (IS_CLAUDE_EDITION) {
    const [{ buildExport }, { getCapability }] = await Promise.all([import('./local/backend'), import('./local/claude')]);
    const file = await buildExport(
      path,
      Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => [key, String(value)])),
    );
    const downloads = await getCapability<DownloadsNs>('downloads');
    if (!downloads) throw new ApiError(0, 'FEATURE_DISABLED', 'Downloads are not available in this view.');
    try {
      await downloads.save(file);
    } catch (error) {
      if ((error as { code?: string })?.code === 'declined') throw new ApiError(0, 'BAD_REQUEST', 'Download cancelled.');
      throw new ApiError(0, 'INTERNAL', 'The file could not be saved. Try again.');
    }
    return;
  }
  const response = await send(path, { query });
  if (!response.ok) throw await toApiError(response);
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Forget the cached CSRF token (e.g. after sign-out). */
export function resetCsrfToken() {
  csrfToken = null;
}
