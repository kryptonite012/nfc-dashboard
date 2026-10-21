import {
  ArrowDownUp,
  BarChart3,
  History,
  LayoutDashboard,
  PlusCircle,
  Settings,
  ShieldCheck,
  Table2,
  Tags,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/app/records', label: 'All Records', icon: Table2 },
      { to: '/app/items/new', label: 'Add New Item', icon: PlusCircle },
      { to: '/app/categories', label: 'Categories', icon: Tags },
      { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/app/data', label: 'Import / Export', icon: ArrowDownUp },
      { to: '/app/activity', label: 'Activity History', icon: History },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/app/security', label: 'Profile & Security', icon: ShieldCheck },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const TITLES: [RegExp, string][] = [
  [/^\/app\/?$/, 'Overview'],
  [/^\/app\/records\/?$/, 'All Records'],
  [/^\/app\/records\/[^/]+\/edit$/, 'Edit record'],
  [/^\/app\/records\/[^/]+$/, 'Record details'],
  [/^\/app\/items\/new$/, 'Add New Item'],
  [/^\/app\/categories$/, 'Categories'],
  [/^\/app\/analytics$/, 'Analytics'],
  [/^\/app\/data$/, 'Import / Export'],
  [/^\/app\/activity$/, 'Activity History'],
  [/^\/app\/security$/, 'Profile & Security'],
  [/^\/app\/settings$/, 'Settings'],
];

/** Breadcrumb trail for the current path. */
export function breadcrumbsFor(pathname: string): { label: string; to?: string }[] {
  const crumbs: { label: string; to?: string }[] = [{ label: 'VaultLedger', to: '/app' }];
  if (/^\/app\/records\/.+/.test(pathname)) crumbs.push({ label: 'All Records', to: '/app/records' });
  const match = TITLES.find(([pattern]) => pattern.test(pathname));
  crumbs.push({ label: match?.[1] ?? 'Not found' });
  return crumbs;
}

export function pageTitle(pathname: string): string {
  return TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'VaultLedger';
}
