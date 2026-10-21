import { decimalStringToMinor, minorToDecimalString, type CurrencyCode } from '@vaultledger/shared';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartCard, CountColumnChart, DataTable, RankedBars, ValueAreaChart, ValueChangesChart } from '@/components/charts/Charts';
import { RANGE_PRESETS, rangeFor, type RangePreset } from '@/components/charts/RangeFilter';
import { Button } from '@/components/ui/button';
import { Alert, ErrorState, PageHeader } from '@/components/ui/feedback';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAnalytics, useCurrentUser, type AnalyticsParams } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatBucket, formatCount, formatDateTime, formatMoney, isZeroAmount } from '@/lib/format';
import { browserTimeZone, todayIso } from '@/lib/utils';

type Preset = RangePreset | 'custom';

export default function AnalyticsPage() {
  const user = useCurrentUser();
  const { locale } = user.settings;
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState(() => ({ ...rangeFor('30d') }));
  const [granularity, setGranularity] = useState<AnalyticsParams['granularity'] | undefined>(undefined);
  const [currency, setCurrency] = useState<CurrencyCode | undefined>(undefined);

  const base = preset === 'custom' ? custom : rangeFor(preset);
  const params: AnalyticsParams = {
    from: base.from,
    to: base.to,
    granularity: granularity ?? base.granularity,
    currency,
    tz: browserTimeZone(),
  };
  const analytics = useAnalytics(params);
  const data = analytics.data;

  const startValue = data?.collectionValue[0]?.value;
  const endValue = data?.collectionValue.at(-1)?.value;
  const netChange = startValue !== undefined && endValue !== undefined && data ? decimalStringToMinor(endValue, data.currency) - decimalStringToMinor(startValue, data.currency) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="How your collection’s value and contents have changed, calculated from your record history." />

      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="an-range" className="text-xs font-medium text-muted-foreground">
              Date range
            </label>
            <NativeSelect id="an-range" className="h-9 w-44" value={preset} onChange={(event) => setPreset(event.target.value as Preset)}>
              {RANGE_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Custom range</option>
            </NativeSelect>
          </div>
          {preset === 'custom' && (
            <>
              <div className="space-y-1">
                <label htmlFor="an-from" className="text-xs font-medium text-muted-foreground">
                  From
                </label>
                <Input
                  id="an-from"
                  type="date"
                  className="h-9"
                  value={custom.from}
                  max={custom.to}
                  onChange={(event) => event.target.value && setCustom((value) => ({ ...value, from: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="an-to" className="text-xs font-medium text-muted-foreground">
                  To
                </label>
                <Input
                  id="an-to"
                  type="date"
                  className="h-9"
                  value={custom.to}
                  min={custom.from}
                  max={todayIso()}
                  onChange={(event) => event.target.value && setCustom((value) => ({ ...value, to: event.target.value }))}
                />
              </div>
            </>
          )}
          <div className="space-y-1">
            <label htmlFor="an-granularity" className="text-xs font-medium text-muted-foreground">
              Group by
            </label>
            <NativeSelect
              id="an-granularity"
              className="h-9 w-32"
              value={params.granularity}
              onChange={(event) => setGranularity(event.target.value as AnalyticsParams['granularity'])}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor="an-currency" className="text-xs font-medium text-muted-foreground">
              Currency
            </label>
            <NativeSelect
              id="an-currency"
              className="h-9 w-28"
              value={data?.currency ?? user.settings.defaultCurrency}
              onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
            >
              {(data?.availableCurrencies ?? [user.settings.defaultCurrency]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </div>
          {analytics.isFetching && <span className="pb-2 text-xs text-muted-foreground">Updating…</span>}
        </div>
      </Card>

      {analytics.isError ? (
        <Card>
          <ErrorState message={errorMessage(analytics.error)} onRetry={() => void analytics.refetch()} />
        </Card>
      ) : !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          <Alert tone="info" title="Two different kinds of change">
            <strong>Collection value</strong> moves when records are added, deleted or re-priced. <strong>Price changes</strong> are edits to an
            individual item’s unit price. Amounts in different currencies are never added together.
          </Alert>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Value at start of range</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{startValue ? formatMoney(startValue, data.currency, locale) : '—'}</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Value now</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{endValue ? formatMoney(endValue, data.currency, locale) : '—'}</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Net change in range</p>
              <p className="mt-2 flex items-center gap-1 text-2xl font-semibold tracking-tight">
                {netChange === null ? (
                  '—'
                ) : (
                  <>
                    {netChange > 0n ? (
                      <ArrowUpRight className="size-5 text-success" aria-label="increase" />
                    ) : netChange < 0n ? (
                      <ArrowDownRight className="size-5 text-destructive" aria-label="decrease" />
                    ) : null}
                    {netChange < 0n ? '−' : netChange > 0n ? '+' : ''}
                    {formatMoney(minorToDecimalString(netChange < 0n ? -netChange : netChange, data.currency), data.currency, locale)}
                  </>
                )}
              </p>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Collection value over time"
              description={`Value of active ${data.currency} records at the end of each ${data.granularity}.`}
              loading={analytics.isFetching}
              table={
                <DataTable
                  columns={['Period', 'Value']}
                  rows={data.collectionValue.map((point) => [formatBucket(point.bucket, data.granularity, locale), formatMoney(point.value, data.currency, locale)])}
                />
              }
            >
              <ValueAreaChart data={data.collectionValue} currency={data.currency} locale={locale} granularity={data.granularity} />
            </ChartCard>
            <ChartCard
              title="What changed the value"
              description="Additions, removals (deleted or moved to another currency) and re-pricing of existing records."
              loading={analytics.isFetching}
              table={
                <DataTable
                  columns={['Period', 'Added', 'Removed', 'Re-priced']}
                  rows={data.valueChanges.map((row) => [
                    formatBucket(row.bucket, data.granularity, locale),
                    formatMoney(row.additions, data.currency, locale),
                    formatMoney(row.removals, data.currency, locale),
                    formatMoney(row.repricing, data.currency, locale),
                  ])}
                />
              }
            >
              <ValueChangesChart data={data.valueChanges} currency={data.currency} locale={locale} granularity={data.granularity} height={228} />
            </ChartCard>
            <ChartCard
              title={`Items added per ${data.granularity}`}
              description="Records created in each period, in every currency."
              loading={analytics.isFetching}
              table={
                <DataTable
                  columns={['Period', 'Items added']}
                  rows={data.itemsAdded.map((row) => [formatBucket(row.bucket, data.granularity, locale), row.count])}
                />
              }
            >
              <CountColumnChart data={data.itemsAdded} locale={locale} granularity={data.granularity} label="items added" />
            </ChartCard>
            <ChartCard title="Price distribution" description={`How many active ${data.currency} records fall into each unit-price band (${data.currency}).`}>
              <RankedBars
                emptyText={`No active ${data.currency} records.`}
                rows={data.priceDistribution.map((band) => ({
                  key: band.label,
                  label: band.label,
                  value: band.count,
                  display: formatCount(band.count, 'item', 'items', locale),
                }))}
              />
            </ChartCard>
            <ChartCard title="Category distribution" description={`Active records per category and their ${data.currency} value.`}>
              <RankedBars
                emptyText="No active records."
                rows={data.categoryDistribution.map((entry) => ({
                  key: entry.categoryId ?? 'none',
                  label: entry.name,
                  value: entry.count,
                  display: formatCount(entry.count, 'item', 'items', locale),
                  secondary: isZeroAmount(entry.value) ? undefined : formatMoney(entry.value, data.currency, locale),
                  color: entry.color,
                }))}
              />
            </ChartCard>
            <ChartCard title="Top items by line total" description={`Unit price × quantity, ${data.currency}.`}>
              <RankedBars
                emptyText={`No active ${data.currency} records.`}
                rows={data.topItems.map((entry) => ({
                  key: entry.id,
                  label: entry.name,
                  value: Number(entry.lineTotal),
                  display: formatMoney(entry.lineTotal, data.currency, locale),
                  secondary: entry.quantity > 1 ? `${formatMoney(entry.price, data.currency, locale)} × ${entry.quantity}` : undefined,
                  href: `/app/records/${entry.id}`,
                }))}
              />
            </ChartCard>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent price changes</CardTitle>
              <p className="text-sm text-muted-foreground">Edits to individual unit prices in this range ({data.currency}), newest first.</p>
            </CardHeader>
            <CardContent>
              {data.priceChanges.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No unit prices were changed in this range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">From</TableHead>
                      <TableHead className="text-right">To</TableHead>
                      <TableHead>Changed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.priceChanges.map((change) => (
                      <TableRow key={`${change.itemId}-${change.changedAt}`}>
                        <TableCell className="max-w-[16rem] truncate">
                          <Link to={`/app/records/${change.itemId}`} className="font-medium hover:underline">
                            {change.name}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">{formatMoney(change.from, data.currency, locale)}</TableCell>
                        <TableCell className="tabular text-right font-medium">{formatMoney(change.to, data.currency, locale)}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(change.changedAt, locale)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground">
            Showing {formatBucket(data.from, 'day', locale)} – {formatBucket(data.to, 'day', locale)} in your time zone ({browserTimeZone()}).{' '}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void analytics.refetch()}>
              Refresh
            </Button>
          </p>
        </>
      )}
    </div>
  );
}
