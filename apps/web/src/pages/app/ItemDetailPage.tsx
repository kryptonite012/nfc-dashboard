import { decimalStringToMinor, minorToDecimalString } from '@vaultledger/shared';
import { ArrowLeft, PackageX, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CategoryBadge } from '@/components/items/CategoryBadge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrentUser, useItem } from '@/hooks/queries';
import { useItemActions } from '@/hooks/useItemActions';
import { errorMessage, isApiError } from '@/lib/api';
import { formatCalendarDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default function ItemDetailPage() {
  const { id } = useParams();
  const user = useCurrentUser();
  const { locale } = user.settings;
  const navigate = useNavigate();
  const item = useItem(id);
  const actions = useItemActions();
  const [confirm, setConfirm] = useState<'trash' | 'purge' | null>(null);

  if (item.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (item.isError) {
    return isApiError(item.error, 'NOT_FOUND') ? (
      <EmptyState
        icon={PackageX}
        title="Record not found"
        description="It may have been permanently deleted, or the link is incorrect."
        action={
          <Button asChild variant="outline">
            <Link to="/app/records">Back to all records</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState message={errorMessage(item.error)} onRetry={() => void item.refetch()} />
    );
  }

  const data = item.data;
  const deleted = Boolean(data.deletedAt);
  const history = data.priceHistory;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link to="/app/records" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> All records
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{data.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={data.category} />
              {deleted && <Badge variant="destructive">In trash</Badge>}
              {data.tags.map((tag) => (
                <Link key={tag} to={`/app/records?tag=${encodeURIComponent(tag)}`}>
                  <Badge variant="secondary">#{tag}</Badge>
                </Link>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {deleted ? (
              <>
                <Button variant="outline" onClick={() => void actions.restore([data.id])} disabled={actions.pending}>
                  <RotateCcw /> Restore
                </Button>
                <Button variant="destructive" onClick={() => setConfirm('purge')}>
                  <Trash2 /> Delete permanently
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setConfirm('trash')}>
                  <Trash2 /> Move to trash
                </Button>
                <Button asChild>
                  <Link to={`/app/records/${data.id}/edit`}>
                    <Pencil /> Edit
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {deleted && (
        <Alert tone="warning" title="This record is in the trash">
          It was moved to the trash {formatDateTime(data.deletedAt!, locale)} and is excluded from your totals. Restore it to edit it.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Price</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">{formatMoney(data.price, data.currency, locale)}</p>
              <p className="text-sm text-muted-foreground">Unit price · {data.currency}</p>
            </div>
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Quantity">{formatNumber(data.quantity, locale)}</Detail>
              <Detail label="Line total">
                <span className="tabular font-medium">{formatMoney(data.lineTotal, data.currency, locale)}</span>
              </Detail>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Detail label="SKU / reference">{data.sku}</Detail>
              <Detail label="Supplier or source">{data.supplier}</Detail>
              <Detail label="Purchase date">{data.purchaseDate ? formatCalendarDate(data.purchaseDate, locale) : null}</Detail>
              <Detail label="Record version">v{data.version}</Detail>
              <Detail label="Created">{formatDateTime(data.createdAt, locale)}</Detail>
              <Detail label="Last updated">{formatDateTime(data.updatedAt, locale)}</Detail>
              <div className="sm:col-span-2">
                <Detail label="Description or notes">
                  {data.description ? <span className="whitespace-pre-wrap break-words">{data.description}</span> : null}
                </Detail>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price history</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every change to this item’s unit price, currency or quantity, newest first. This is separate from changes to your collection’s
            total value, which also moves when records are added or deleted.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recorded</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry, index) => {
                const previous = history[index + 1];
                let change: string | null = null;
                let direction = 0;
                if (previous && previous.currency === entry.currency) {
                  const delta = decimalStringToMinor(entry.price, entry.currency) - decimalStringToMinor(previous.price, previous.currency);
                  direction = delta > 0n ? 1 : delta < 0n ? -1 : 0;
                  if (delta !== 0n) {
                    const abs = minorToDecimalString(delta < 0n ? -delta : delta, entry.currency);
                    change = `${delta > 0n ? '+' : '−'}${formatMoney(abs, entry.currency, locale)}`;
                  }
                } else if (previous) {
                  change = `${previous.currency} → ${entry.currency}`;
                }
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(entry.recordedAt, locale)}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(entry.price, entry.currency, locale)}</TableCell>
                    <TableCell className="tabular text-right">{formatNumber(entry.quantity, locale)}</TableCell>
                    <TableCell className={cn('tabular text-right', direction !== 0 && 'font-medium')}>
                      {index === history.length - 1 ? <span className="text-muted-foreground">Initial</span> : (change ?? <span className="text-muted-foreground">Quantity only</span>)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        destructive
        loading={actions.pending}
        title={confirm === 'purge' ? 'Permanently delete this record?' : 'Move this record to trash?'}
        description={
          confirm === 'purge'
            ? `“${data.name}” and its price history will be erased. This cannot be undone.`
            : `“${data.name}” will stop counting towards your totals. You can restore it from the trash.`
        }
        confirmLabel={confirm === 'purge' ? 'Delete permanently' : 'Move to trash'}
        onConfirm={() => {
          const run = confirm === 'purge' ? actions.purge([data.id]) : actions.moveToTrash([data]);
          void run.then((affected) => {
            setConfirm(null);
            if (affected > 0) navigate(confirm === 'purge' ? '/app/records?status=deleted' : '/app/records');
          });
        }}
      />
    </div>
  );
}
