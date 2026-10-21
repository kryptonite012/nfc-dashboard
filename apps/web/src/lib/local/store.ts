import { DEFAULT_CURRENCY, type CategoryColor, type CurrencyCode, type UserSettings } from '@vaultledger/shared';
import { ApiError } from '@/lib/api';
import { getCapability, type CollectionRef, type Db, type DocRef, type UserNs } from './claude';

/**
 * Data access for the Claude edition. Everything lives in the viewer's private
 * `data/users/<id>/` space, which the platform hides from every other person,
 * the artifact's owner included:
 *
 *   data/users/<id>/profile                  settings and notifications
 *   data/users/<id>/profile/items/<itemId>   one record, with its price history and value events
 *   data/users/<id>/profile/categories/<id>
 *   data/users/<id>/profile/archive/<year>   value events of permanently deleted records
 *   data/users/<id>/profile/activity/<month> activity history, one document per month
 *
 * Items, categories, the profile and the archive are kept in memory through live
 * subscriptions, so reads are instant and changes made on another device appear here.
 */

export interface StoredEvent {
  /** ADD / REMOVE / REPRICE, as in the server's value ledger. */
  k: 'ADD' | 'REMOVE' | 'REPRICE';
  c: CurrencyCode;
  /** Signed change in Σ(unit price × quantity), integer minor units as a string. */
  d: string;
  at: string;
}

export interface StoredHistory {
  p: string;
  c: CurrencyCode;
  q: number;
  at: string;
}

export interface StoredItem {
  id: string;
  name: string;
  priceMinor: string;
  currency: CurrencyCode;
  quantity: number;
  categoryId: string | null;
  sku: string | null;
  description: string | null;
  supplier: string | null;
  purchaseDate: string | null;
  tags: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  history: StoredHistory[];
  events: StoredEvent[];
  /** Idempotency key of the request that created the record. */
  clientRequestId?: string;
}

export interface StoredCategory {
  id: string;
  name: string;
  nameKey: string;
  color: CategoryColor;
  createdAt: string;
  updatedAt: string;
}

export interface StoredNotification {
  id: string;
  kind: 'security' | 'data' | 'account';
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface StoredActivity {
  id: string;
  type: string;
  summary: string;
  entityId: string | null;
  createdAt: string;
}

export interface Profile {
  settings: UserSettings;
  createdAt: string;
  notifications: StoredNotification[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultCurrency: DEFAULT_CURRENCY,
  theme: 'system',
  locale: 'en-IN',
  showQuantity: true,
};

const MAX_EVENTS_PER_ITEM = 300;
const MAX_HISTORY_PER_ITEM = 200;
const MAX_ACTIVITY_PER_MONTH = 1500;
const MAX_NOTIFICATIONS = 30;

function storageError(error: unknown): ApiError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'invalid_argument' || code === 'not_granted') {
    return new ApiError(
      403,
      'FORBIDDEN',
      'You can view this page but not save records. Ask the person who shared it for Contributor access.',
    );
  }
  if (code === 'quota_exceeded') {
    return new ApiError(409, 'CONFLICT', 'Storage for this app is full. Permanently delete some records from the trash and try again.');
  }
  if (code === 'resource_exhausted') {
    return new ApiError(429, 'RATE_LIMITED', 'Too many changes at once. Wait a moment and try again.');
  }
  return new ApiError(503, 'INTERNAL', 'Your records could not be saved right now. Check your connection and try again.');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Keeps a bounded event list exact by folding the oldest event into the next one of the same currency. */
function compactEvents(events: StoredEvent[]): StoredEvent[] {
  const next = [...events];
  while (next.length > MAX_EVENTS_PER_ITEM) {
    const first = next.shift()!;
    const target = next.find((event) => event.c === first.c);
    if (target) target.d = (BigInt(target.d) + BigInt(first.d)).toString();
    else {
      next.unshift(first);
      break;
    }
  }
  return next;
}

export class LocalStore {
  uid: string | null = null;
  displayName = '';
  isOwner = false;
  items = new Map<string, StoredItem>();
  categories = new Map<string, StoredCategory>();
  archive: StoredEvent[] = [];
  profile: Profile = { settings: { ...DEFAULT_SETTINGS }, createdAt: new Date().toISOString(), notifications: [] };
  private db: Db | null = null;
  private profileExists = false;
  private writeChains = new Map<string, Promise<unknown>>();
  private readyPromise: Promise<boolean> | null = null;
  private initialised = false;

  ready(): Promise<boolean> {
    this.readyPromise ??= this.connect();
    return this.readyPromise;
  }

  private base(): string {
    return `data/users/${this.uid}`;
  }

  private profileRef(): DocRef {
    return this.db!.doc(`${this.base()}/profile`);
  }

  private sub(name: 'items' | 'categories' | 'archive' | 'activity'): CollectionRef {
    return this.profileRef().collection(name);
  }

  private async connect(): Promise<boolean> {
    const [db, user] = await Promise.all([getCapability<Db>('db'), getCapability<UserNs>('user')]);
    if (!db || !user) return false;
    const me = await user.me();
    if (!me.id) return false;
    this.db = db;
    this.uid = me.id;
    this.displayName = me.name;
    this.isOwner = me.isOwner;

    const pending = { items: true, categories: true, profile: true, archive: true };
    return new Promise<boolean>((resolve) => {
      const finish = () => {
        if (this.initialised) return;
        this.initialised = true;
        resolve(true);
      };
      // The first deliveries can come from a local cache; wait for the server's answer,
      // but never longer than a few seconds (a later delivery refreshes the screen).
      setTimeout(finish, 4000);
      const settle = (key: keyof typeof pending, fromCache = false) => {
        if (!fromCache) pending[key] = false;
        if (!this.initialised) {
          if (Object.values(pending).every((value) => !value)) finish();
        } else {
          window.dispatchEvent(new CustomEvent('vaultledger:data-changed'));
        }
      };
      const fail = () => {
        if (!this.initialised) resolve(false);
      };
      this.sub('items').onSnapshot((snap) => {
        this.items = new Map(snap.docs.filter((doc) => doc.exists).map((doc) => [doc.id, { ...(doc.data() as unknown as StoredItem), id: doc.id }]));
        settle('items', snap.metadata?.fromCache);
      }, fail);
      this.sub('categories').onSnapshot((snap) => {
        this.categories = new Map(
          snap.docs.filter((doc) => doc.exists).map((doc) => [doc.id, { ...(doc.data() as unknown as StoredCategory), id: doc.id }]),
        );
        settle('categories', snap.metadata?.fromCache);
      }, fail);
      this.sub('archive').onSnapshot((snap) => {
        this.archive = snap.docs.flatMap((doc) => ((doc.data()?.events as StoredEvent[] | undefined) ?? []));
        settle('archive', snap.metadata?.fromCache);
      }, fail);
      this.profileRef().onSnapshot((snap) => {
        this.profileExists = snap.exists;
        const data = snap.data() as Partial<Profile> | undefined;
        this.profile = {
          settings: { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) },
          createdAt: data?.createdAt ?? this.profile.createdAt,
          notifications: data?.notifications ?? [],
        };
        settle('profile', snap.metadata?.fromCache);
      }, fail);
    });
  }

  /** Serialises writes per document, as the store requires. */
  private enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(path) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    this.writeChains.set(path, run);
    return run;
  }

  async saveProfile(patch: Partial<Profile>): Promise<void> {
    const next: Profile = { ...this.profile, ...patch };
    this.profile = next;
    const ref = this.profileRef();
    await this.enqueue(ref.path, async () => {
      try {
        await ref.set(clone(next) as unknown as Record<string, unknown>);
        this.profileExists = true;
      } catch (error) {
        throw storageError(error);
      }
    });
  }

  async ensureProfile(): Promise<void> {
    if (!this.profileExists) await this.saveProfile({});
  }

  async saveItem(item: StoredItem): Promise<void> {
    const body: StoredItem = {
      ...item,
      history: item.history.slice(-MAX_HISTORY_PER_ITEM),
      events: compactEvents(item.events),
    };
    this.items.set(item.id, body);
    const ref = this.sub('items').doc(item.id);
    await this.enqueue(ref.path, async () => {
      try {
        const { id: _id, ...rest } = body;
        await ref.set(clone(rest) as unknown as Record<string, unknown>);
      } catch (error) {
        throw storageError(error);
      }
    });
  }

  async deleteItem(id: string): Promise<void> {
    this.items.delete(id);
    const ref = this.sub('items').doc(id);
    await this.enqueue(ref.path, async () => {
      try {
        await ref.delete();
      } catch (error) {
        throw storageError(error);
      }
    });
  }

  async saveCategory(category: StoredCategory): Promise<void> {
    this.categories.set(category.id, category);
    const ref = this.sub('categories').doc(category.id);
    await this.enqueue(ref.path, async () => {
      try {
        const { id: _id, ...rest } = category;
        await ref.set(clone(rest) as unknown as Record<string, unknown>);
      } catch (error) {
        throw storageError(error);
      }
    });
  }

  async deleteCategory(id: string): Promise<void> {
    this.categories.delete(id);
    const ref = this.sub('categories').doc(id);
    await this.enqueue(ref.path, async () => {
      try {
        await ref.delete();
      } catch (error) {
        throw storageError(error);
      }
    });
  }

  /** Keeps the value history of permanently deleted records, grouped per year. */
  async archiveEvents(events: StoredEvent[]): Promise<void> {
    if (events.length === 0) return;
    const year = new Date().getUTCFullYear().toString();
    const ref = this.sub('archive').doc(year);
    this.archive = [...this.archive, ...events];
    await this.enqueue(ref.path, async () => {
      try {
        const snap = await ref.get();
        const existing = (snap.data()?.events as StoredEvent[] | undefined) ?? [];
        await ref.set({ events: [...existing, ...events] });
      } catch (error) {
        throw storageError(error);
      }
    });
  }

  async logActivity(entry: Omit<StoredActivity, 'id' | 'createdAt'>): Promise<void> {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const ref = this.sub('activity').doc(month);
    const record: StoredActivity = { ...entry, id: crypto.randomUUID(), createdAt: now.toISOString() };
    await this.enqueue(ref.path, async () => {
      try {
        const snap = await ref.get();
        const entries = ((snap.data()?.entries as StoredActivity[] | undefined) ?? []).slice(-(MAX_ACTIVITY_PER_MONTH - 1));
        await ref.set({ entries: [...entries, record] });
      } catch {
        // Activity history is best-effort; never fail the user's action because of it.
      }
    });
  }

  async activity(): Promise<StoredActivity[]> {
    const snap = await this.sub('activity').get();
    return snap.docs
      .flatMap((doc) => ((doc.data()?.entries as StoredActivity[] | undefined) ?? []))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async notify(notification: Omit<StoredNotification, 'id' | 'readAt' | 'createdAt'>): Promise<void> {
    const entry: StoredNotification = { ...notification, id: crypto.randomUUID(), readAt: null, createdAt: new Date().toISOString() };
    await this.saveProfile({ notifications: [entry, ...this.profile.notifications].slice(0, MAX_NOTIFICATIONS) });
  }

  /** Erases every document in this viewer's space. */
  async deleteEverything(): Promise<void> {
    const collections = ['items', 'categories', 'archive', 'activity'] as const;
    for (const name of collections) {
      const snap = await this.sub(name).get();
      for (const doc of snap.docs) {
        try {
          await this.sub(name).doc(doc.id).delete();
        } catch (error) {
          throw storageError(error);
        }
      }
    }
    try {
      await this.profileRef().delete();
    } catch (error) {
      throw storageError(error);
    }
    this.items.clear();
    this.categories.clear();
    this.archive = [];
    this.profileExists = false;
    this.profile = { settings: { ...DEFAULT_SETTINGS }, createdAt: new Date().toISOString(), notifications: [] };
  }
}

export const store = new LocalStore();
