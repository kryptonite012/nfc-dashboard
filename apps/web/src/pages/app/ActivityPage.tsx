import type { ActivityType } from '@vaultledger/shared';
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  History,
  KeyRound,
  LogIn,
  LogOut,
  Package,
  PackageMinus,
  PackagePlus,
  Pencil,
  RotateCcw,
  Settings,
  ShieldAlert,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/feedback';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/menu';
import { Card, Skeleton } from '@/components/ui/primitives';
import { useActivity, useCurrentUser } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

function iconFor(type: ActivityType): { icon: LucideIcon; tone: string } {
  if (type === 'auth.login_failed') return { icon: ShieldAlert, tone: 'bg-destructive/10 text-destructive' };
  if (type === 'auth.login') return { icon: LogIn, tone: 'bg-primary/10 text-primary' };
  if (type === 'auth.logout' || type === 'auth.session_revoked') return { icon: LogOut, tone: 'bg-muted text-muted-foreground' };
  if (type.startsWith('auth.')) return { icon: KeyRound, tone: 'bg-warning/10 text-warning' };
  if (type.startsWith('account.')) return { icon: Settings, tone: 'bg-muted text-muted-foreground' };
  if (type === 'item.created') return { icon: PackagePlus, tone: 'bg-success/10 text-success' };
  if (type === 'item.updated') return { icon: Pencil, tone: 'bg-primary/10 text-primary' };
  if (type === 'item.deleted' || type === 'item.purged') return { icon: PackageMinus, tone: 'bg-destructive/10 text-destructive' };
  if (type === 'item.restored') return { icon: RotateCcw, tone: 'bg-success/10 text-success' };
  if (type.startsWith('category.')) return { icon: Tags, tone: 'bg-muted text-muted-foreground' };
  if (type.startsWith('data.')) return { icon: ArrowDownUp, tone: 'bg-primary/10 text-primary' };
  return { icon: Package, tone: 'bg-muted text-muted-foreground' };
}

const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'items', label: 'Records' },
  { value: 'security', label: 'Security' },
  { value: 'data', label: 'Import & export' },
];

export default function ActivityPage() {
  const user = useCurrentUser();
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(1);
  const activity = useActivity({ page, pageSize: 25, scope });
  const meta = activity.data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader title="Activity History" description="A log of changes to your records and security events on your account." />
      <Tabs
        value={scope}
        onValueChange={(value) => {
          setScope(value);
          setPage(1);
        }}
      >
        <TabsList className="h-auto flex-wrap">
          {SCOPES.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card>
        {activity.isError ? (
          <ErrorState message={errorMessage(activity.error)} onRetry={() => void activity.refetch()} />
        ) : activity.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : activity.data.data.length === 0 ? (
          <EmptyState icon={History} title="No activity yet" description="Changes you make will be listed here." />
        ) : (
          <ol className={cn('divide-y transition-opacity', activity.isPlaceholderData && 'opacity-60')}>
            {activity.data.data.map((entry) => {
              const { icon: Icon, tone } = iconFor(entry.type);
              const linkable = entry.entityId && entry.type.startsWith('item.') && entry.type !== 'item.purged';
              return (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', tone)}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {linkable ? (
                        <Link to={`/app/records/${entry.entityId}`} className="hover:underline">
                          {entry.summary}
                        </Link>
                      ) : (
                        entry.summary
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt, user.settings.locale)}>
                        {formatRelative(entry.createdAt)}
                      </time>
                      {entry.ipAddress && ` · IP ${entry.ipAddress}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Page {meta.page} of {meta.totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((value) => value + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
