import { ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { QuickAddProvider } from '@/components/items/QuickAdd';
import { Logo, LogoMark } from '@/components/layout/Logo';
import { NAV_SECTIONS, pageTitle, type NavItem } from '@/components/layout/nav';
import { Topbar } from '@/components/layout/Topbar';
import { Dialog, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/menu';
import { useLogout } from '@/hooks/useLogout';
import { IS_CLAUDE_EDITION } from '@/lib/edition';
import { cn } from '@/lib/utils';

const COLLAPSE_KEY = 'vl-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function NavEntry({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-offset-sidebar',
          isActive
            ? 'bg-sidebar-accent text-white shadow-sm'
            : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <item.icon className="size-[18px] shrink-0" aria-hidden />
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const logout = useLogout();
  const logoutButton = (
    <button
      type="button"
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-offset-sidebar',
        collapsed && 'justify-center px-0',
      )}
    >
      <LogOut className="size-[18px] shrink-0" aria-hidden />
      <span className={cn(collapsed && 'sr-only')}>{logout.isPending ? 'Signing out…' : 'Logout'}</span>
    </button>
  );
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="space-y-1">
          <p className={cn('px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted/80', collapsed && 'sr-only')}>
            {section.label}
          </p>
          {section.items.map((item) => (
            <NavEntry key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      {/* In the Claude edition people sign in and out through claude.ai itself. */}
      {!IS_CLAUDE_EDITION && (
        <div className="mt-auto border-t border-sidebar-border pt-3">
          {collapsed ? (
            <Tooltip content="Logout" side="right">
              {logoutButton}
            </Tooltip>
          ) : (
            logoutButton
          )}
        </div>
      )}
    </nav>
  );
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} · VaultLedger`;
  }, [location.pathname]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1');
      } catch {
        /* preference just won't persist */
      }
      return !value;
    });
  };

  return (
    <QuickAddProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex',
            collapsed ? 'w-[72px]' : 'w-64',
          )}
        >
          <div className={cn('flex h-16 items-center border-b border-sidebar-border px-4', collapsed && 'justify-center px-0')}>
            {collapsed ? <LogoMark /> : <Logo />}
          </div>
          <SidebarNav collapsed={collapsed} />
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-11 items-center justify-center gap-2 border-t border-sidebar-border text-xs font-medium text-sidebar-muted transition-colors hover:text-sidebar-foreground"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </button>
        </aside>

        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="bg-sidebar text-sidebar-foreground" aria-describedby={undefined}>
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <div className="flex h-16 items-center border-b border-sidebar-border px-4">
              <Logo />
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Dialog>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMenu={() => setMobileOpen(true)} />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            <Outlet />
          </main>
          <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
            VaultLedger ·{' '}
            <Link className="hover:underline" to="/privacy">
              Privacy
            </Link>{' '}
            ·{' '}
            <Link className="hover:underline" to="/terms">
              Terms
            </Link>
          </footer>
        </div>
      </div>
    </QuickAddProvider>
  );
}
