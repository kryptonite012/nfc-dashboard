import type { ItemDTO, SupportedLocale } from '@vaultledger/shared';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CategoryDot } from '@/components/items/CategoryBadge';
import { Tooltip } from '@/components/ui/menu';
import { Card, Skeleton } from '@/components/ui/primitives';
import { formatMoney, formatRelative } from '@/lib/format';

export function StatTile({
  label,
  value,
  detail,
  info,
  loading,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  info?: string;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {label}
          {info && (
            <Tooltip content={info}>
              <button type="button" className="rounded-full text-muted-foreground/80 hover:text-foreground" aria-label={`About ${label}: ${info}`}>
                <Info className="size-3.5" />
              </button>
            </Tooltip>
          )}
        </p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-2 h-4 w-24" />
        </>
      ) : (
        <>
          <div className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</div>
          {detail && <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>}
        </>
      )}
    </Card>
  );
}

export function ItemRowList({
  items,
  locale,
  timestamp,
  emptyText,
}: {
  items: ItemDTO[];
  locale: SupportedLocale;
  timestamp: 'createdAt' | 'updatedAt';
  emptyText: string;
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.id}>
          <Link to={`/app/records/${item.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-muted/60">
            <span className="flex min-w-0 items-center gap-2.5">
              <CategoryDot color={item.category?.color ?? null} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {timestamp === 'createdAt' ? 'Added' : 'Updated'} {formatRelative(item[timestamp])}
                  {item.category ? ` · ${item.category.name}` : ''}
                </span>
              </span>
            </span>
            <span className="tabular shrink-0 text-sm font-medium">{formatMoney(item.price, item.currency, locale)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
