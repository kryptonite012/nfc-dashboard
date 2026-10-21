import type { ThemePreference } from '@vaultledger/shared';
import { Bell, ChevronRight, LogOut, Menu, Monitor, Moon, Plus, Search, Settings, ShieldCheck, Sun } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CategoryDot } from '@/components/items/CategoryBadge';
import { useQuickAdd } from '@/components/items/QuickAdd';
import { LogoMark } from '@/components/layout/Logo';
import { breadcrumbsFor } from '@/components/layout/nav';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/primitives';
import { useCurrentUser, useItems, useMarkNotificationsRead, useNotifications, useUpdateSettings } from '@/hooks/queries';
import { useLogout } from '@/hooks/useLogout';
import { formatMoney, formatRelative } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { cn, initials } from '@/lib/utils';

function Breadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = breadcrumbsFor(pathname);
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            <li className="min-w-0 truncate">
              {crumb.to && index < crumbs.length - 1 ? (
                <Link to={crumb.to} className="text-muted-foreground hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="font-medium">
                  {crumb.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function GlobalSearch() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(query.trim());
  const results = useItems(
    { page: 1, pageSize: 6, q: term, sort: 'updatedAt', order: 'desc', status: 'active' },
    { enabled: term.length >= 2 },
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goToAll = () => {
    if (!query.trim()) return;
    setOpen(false);
    navigate(`/app/records?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <Popover open={open && term.length >= 2} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <form
          role="search"
          className="relative w-full max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            goToAll();
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
            placeholder="Search items, SKUs, tags…"
            aria-label="Search records"
            aria-controls={listId}
            aria-expanded={open && term.length >= 2}
            maxLength={100}
            className="h-9 w-full rounded-md border border-input bg-muted/40 pl-9 pr-12 text-sm placeholder:text-muted-foreground focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-card px-1.5 text-[10px] font-medium text-muted-foreground sm:block">
            Ctrl K
          </kbd>
        </form>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[18rem]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div id={listId} className="max-h-80 overflow-y-auto p-1">
          {results.isFetching && !results.data ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : results.isError ? (
            <p className="p-3 text-sm text-destructive">Search is unavailable right now.</p>
          ) : results.data?.data.length ? (
            <ul aria-label="Matching records">
              {results.data.data.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/app/records/${item.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-3 rounded-sm px-2 py-2 text-sm hover:bg-accent focus-visible:bg-accent"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <CategoryDot color={item.category?.color ?? null} />
                      <span className="truncate">{item.name}</span>
                    </span>
                    <span className="tabular shrink-0 text-muted-foreground">{formatMoney(item.price, item.currency, user.settings.locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">No records match “{term}”.</p>
          )}
        </div>
        <div className="border-t p-1">
          <button type="button" onClick={goToAll} className="w-full rounded-sm px-2 py-2 text-left text-sm font-medium text-primary hover:bg-accent">
            See all results for “{query.trim()}”
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationsMenu() {
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();
  const unread = notifications.data?.meta?.unread ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="link" size="sm" className="h-auto p-0" disabled={!unread || markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            Mark all as read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.isPending ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : notifications.isError ? (
            <p className="p-4 text-sm text-destructive">Notifications could not be loaded.</p>
          ) : notifications.data.data.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You’re all caught up. Security alerts and import results will appear here.</p>
          ) : (
            <ul>
              {notifications.data.data.map((notification) => (
                <li key={notification.id} className="border-b last:border-0">
                  <button
                    type="button"
                    className="flex w-full gap-3 px-4 py-3 text-left hover:bg-accent/60"
                    onClick={() => {
                      if (!notification.readAt) markRead.mutate({ ids: [notification.id] });
                      if (notification.link?.startsWith('/app')) navigate(notification.link);
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn('mt-1.5 size-2 shrink-0 rounded-full', notification.readAt ? 'bg-transparent' : 'bg-primary')}
                    />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{notification.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(notification.createdAt)}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">{notification.body}</span>
                      {!notification.readAt && <span className="sr-only">Unread</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const updateSettings = useUpdateSettings();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${theme}. Change theme`}>
          {resolved === 'dark' ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {THEME_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => {
              setTheme(option.value);
              updateSettings.mutate({ theme: option.value });
            }}
            className={cn(theme === option.value && 'font-semibold')}
          >
            <option.icon /> {option.label}
            {theme === option.value && <span className="ml-auto text-xs text-primary">Active</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const user = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground ring-offset-background transition hover:opacity-90"
          aria-label="Account menu"
        >
          {initials(user.name)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
          <span className="block truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/app/security')}>
          <ShieldCheck /> Profile &amp; Security
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/app/settings')}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => logout.mutate()}>
          <LogOut /> Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const quickAdd = useQuickAdd();
  return (
    <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
        <Link to="/app" className="flex items-center gap-2 lg:hidden" aria-label="VaultLedger home">
          <LogoMark className="size-7" />
          <span className="hidden font-semibold sm:inline">VaultLedger</span>
        </Link>
        <div className="min-w-0 flex-1">
          <Breadcrumbs />
        </div>
        <div className="hidden w-full max-w-sm sm:block">
          <GlobalSearch />
        </div>
        <Button variant="ghost" size="icon" className="sm:hidden" asChild>
          <Link to="/app/records" aria-label="Search records">
            <Search className="size-[18px]" />
          </Link>
        </Button>
        <Button size="sm" onClick={quickAdd.open} className="hidden md:inline-flex">
          <Plus /> Quick add
        </Button>
        <Button size="icon" variant="ghost" onClick={quickAdd.open} className="md:hidden" aria-label="Quick add item">
          <Plus className="size-5" />
        </Button>
        <NotificationsMenu />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
