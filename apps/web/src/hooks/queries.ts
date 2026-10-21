import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ActivityDTO,
  AnalyticsDTO,
  BulkActionInput,
  CategoryDTO,
  CategoryInput,
  CreateItemInput,
  ImportResultDTO,
  ItemDetailDTO,
  ItemDTO,
  NotificationDTO,
  OverviewDTO,
  PaginationMeta,
  PublicConfig,
  SessionDTO,
  SettingsInput,
  UpdateItemInput,
  UserDTO,
} from '@vaultledger/shared';
import { createContext, useContext } from 'react';
import { api } from '@/lib/api';

export const queryKeys = {
  config: ['config'] as const,
  session: ['session'] as const,
  items: (params?: object) => (params ? (['items', params] as const) : (['items'] as const)),
  item: (id: string) => ['item', id] as const,
  categories: ['categories'] as const,
  overview: ['overview'] as const,
  analytics: (params?: object) => (params ? (['analytics', params] as const) : (['analytics'] as const)),
  activity: (params?: object) => (params ? (['activity', params] as const) : (['activity'] as const)),
  notifications: ['notifications'] as const,
  sessions: ['sessions'] as const,
};

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: async () => (await api<PublicConfig>('/api/config')).data,
    staleTime: 5 * 60_000,
  });
}

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => (await api<{ user: UserDTO | null }>('/api/auth/session')).data.user,
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * Provided by the authentication guard. Components below it read the user from
 * context rather than the session query, so they never render without one
 * (e.g. during sign-out, the guard swaps them for a redirect first).
 */
export const CurrentUserContext = createContext<UserDTO | null>(null);

/** The signed-in user. Only call inside routes guarded by RequireAuth. */
export function useCurrentUser(): UserDTO {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUser called outside of an authenticated route');
  return user;
}

/** Everything derived from item data must refresh after an item changes. */
export function invalidateItemData(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.items() }),
    client.invalidateQueries({ queryKey: ['item'] }),
    client.invalidateQueries({ queryKey: queryKeys.overview }),
    client.invalidateQueries({ queryKey: queryKeys.analytics() }),
    client.invalidateQueries({ queryKey: queryKeys.categories }),
    client.invalidateQueries({ queryKey: queryKeys.activity() }),
    client.invalidateQueries({ queryKey: queryKeys.notifications }),
  ]);
}

export interface ItemListParams {
  page: number;
  pageSize: number;
  q?: string;
  sort: 'name' | 'price' | 'createdAt' | 'updatedAt';
  order: 'asc' | 'desc';
  categoryId?: string;
  currency?: string;
  minPrice?: string;
  maxPrice?: string;
  from?: string;
  to?: string;
  tag?: string;
  status: 'active' | 'deleted';
  tz?: string;
}

export function useItems(params: ItemListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.items(params),
    queryFn: async ({ signal }) => api<ItemDTO[], PaginationMeta>('/api/items', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.item(id ?? ''),
    queryFn: async () => (await api<ItemDetailDTO>(`/api/items/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useCreateItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, requestKey }: { input: CreateItemInput; requestKey: string }) =>
      (await api<ItemDTO>('/api/items', { method: 'POST', body: input, headers: { 'Idempotency-Key': requestKey } })).data,
    onSuccess: () => invalidateItemData(client),
  });
}

export function useUpdateItem(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateItemInput) => (await api<ItemDTO>(`/api/items/${id}`, { method: 'PATCH', body: input })).data,
    onSuccess: () => invalidateItemData(client),
  });
}

export function useBulkAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkActionInput) => (await api<{ affected: number }>('/api/items/bulk', { method: 'POST', body: input })).data,
    onSuccess: () => invalidateItemData(client),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: async () => (await api<CategoryDTO[]>('/api/categories')).data,
    staleTime: 30_000,
  });
}

export function useSaveCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: CategoryInput }) =>
      (await api<CategoryDTO>(id ? `/api/categories/${id}` : '/api/categories', { method: id ? 'PATCH' : 'POST', body: input })).data,
    onSuccess: () => invalidateItemData(client),
  });
}

export function useDeleteCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateItemData(client),
  });
}

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: async () => (await api<OverviewDTO>('/api/insights/overview')).data,
  });
}

export interface AnalyticsParams {
  from?: string;
  to?: string;
  granularity: 'day' | 'week' | 'month';
  currency?: string;
  tz: string;
}

export function useAnalytics(params: AnalyticsParams) {
  return useQuery({
    queryKey: queryKeys.analytics(params),
    queryFn: async ({ signal }) => (await api<AnalyticsDTO>('/api/insights/analytics', { query: { ...params }, signal })).data,
    placeholderData: keepPreviousData,
  });
}

export function useActivity(params: { page: number; pageSize: number; scope: string }) {
  return useQuery({
    queryKey: queryKeys.activity(params),
    queryFn: async () => api<ActivityDTO[], PaginationMeta>('/api/insights/activity', { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: async () => api<NotificationDTO[], { unread: number }>('/api/insights/notifications'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids?: string[]; all?: boolean }) => api('/api/insights/notifications/read', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => (await api<SessionDTO[]>('/api/account/sessions')).data,
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<SettingsInput>) => (await api<UserDTO>('/api/account/settings', { method: 'PATCH', body: input })).data,
    onSuccess: (user) => {
      client.setQueryData(queryKeys.session, user);
      void client.invalidateQueries({ queryKey: queryKeys.overview });
      void client.invalidateQueries({ queryKey: queryKeys.analytics() });
    },
  });
}

export function useImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { csv: string; commit: boolean; defaultCurrency: string; createMissingCategories: boolean }) =>
      (await api<ImportResultDTO>('/api/data/import', { method: 'POST', body: input })).data,
    onSuccess: (result) => {
      if (result.committed) void invalidateItemData(client);
    },
  });
}
