/**
 * Minimal typings for the claude.ai artifact runtime capabilities used by the Claude edition
 * (`db`, `user`, `downloads`). The runtime exposes them through `window.claude.use(name)`.
 */

export interface DbSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
  metadata?: { fromCache: boolean; hasPendingWrites: boolean };
}

export interface QuerySnapshot {
  docs: DbSnapshot[];
  size: number;
  empty: boolean;
  metadata?: { fromCache: boolean; hasPendingWrites: boolean };
}

export interface DocRef {
  id: string;
  path: string;
  get(): Promise<DbSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (snap: DbSnapshot) => void, error?: (e: { code: string; message: string }) => void): () => void;
  collection(path: string): CollectionRef;
}

export interface Query {
  where(field: string, op: string, value: unknown): Query;
  orderBy(field: string, dir?: 'asc' | 'desc'): Query;
  limit(n: number): Query;
  get(): Promise<QuerySnapshot>;
  onSnapshot(next: (snap: QuerySnapshot) => void, error?: (e: { code: string; message: string }) => void): () => void;
}

export interface CollectionRef extends Query {
  path: string;
  doc(id?: string): DocRef;
}

export interface Db {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
}

export interface UserNs {
  id(): Promise<string | null>;
  me(): Promise<{ id: string | null; name: string; avatarUrl: string; email: string | null; isOwner: boolean }>;
}

export interface DownloadsNs {
  save(request: { filename: string; data: string | Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}

interface ClaudeRuntime {
  use(name: 'db'): Promise<Db | null>;
  use(name: 'user'): Promise<UserNs | null>;
  use(name: 'downloads'): Promise<DownloadsNs | null>;
}

declare global {
  interface Window {
    claude?: ClaudeRuntime;
  }
}

export async function getCapability<T>(name: 'db' | 'user' | 'downloads'): Promise<T | null> {
  const runtime = window.claude;
  if (!runtime?.use) return null;
  try {
    return ((await runtime.use(name as 'db')) as T | null) ?? null;
  } catch {
    return null;
  }
}
