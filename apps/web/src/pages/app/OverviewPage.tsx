import type { CurrencyCode } from '@vaultledger/shared';
import { ArrowRight, FileUp, PackagePlus, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartCard, CountColumnChart, DataTable, RankedBars, ValueAreaChart } from '@/components/charts/Charts';
import { RangeFilter, rangeFor, type RangePreset } from '@/components/charts/RangeFilter';
import { ItemRowList, StatTile } from '@/components/items/ItemBits';
import { useQuickAdd } from '@/components/items/QuickAdd';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/feedback';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { useAnalytics, useCurrentUser, useOverview } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatBucket, formatCount, formatMoney, formatNumber, isZeroAmount } from '@/lib/format';
import { browserTimeZone } from '@/lib/utils';

export default function OverviewPage() {
  const user = useCurrentUser();
  const { locale } = user.settings;
  const quickAdd = useQuickAdd();
  const overview = useOverview();
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [currency, setCurrency] = useState<CurrencyCode | undefined>(undefined);
  const range = rangeFor(preset);
  const analytics = useAnalytics({ ...range, currency, tz: browserTimeZone() });

  const primary = overview.data?.currencies[0];
  const others = overview.data?.currencies.slice(1) ?? [];
  const chartCurrency = analytics.data?.currency ?? user.settings.defaultCurrency;
  const empty = overview.data && overview.data.totalRecords === 0 && overview.data.deletedCount === 0;

  const refresh = () => {
    void overview.refetch();
    void analytics.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user.name.split(' ')[0]}`}
        description="Your collection at a glance. All figures are calculated from your saved records."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh} disabled={overview.isFetching || analytics.isFetching}>
              <RefreshCw className={overview.isFetching || analytics.isFetching ? 'animate-spin' : undefined} /> Refresh
            </Button>
            <Button size="sm" onClick={quickAdd.open}>
              <Plus /> Add item
            </Button>
          </>
        }
      />

      {user.phone && !user.phoneVerified && (
        <Alert tone="warning" title="Verify your phone number" action={<Button asChild size="sm" variant="outline"><Link to="/app/security">Verify</Link></Button>}>
          {user.phone} isn’t verified yet, so it can’t be used to sign in or recover your account.
        </Alert>
      )}

      {overview.isError ? (
        <Card>
          <ErrorState message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
        </Card>
      ) : empty ? (
        <Card>
          <EmptyState
            icon={PackagePlus}
            title="Add your first item"
            description="Record an item and its price to start building your collection. Your totals and charts will appear here."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={quickAdd.open}>
                  <Plus /> Add an item
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/app/data">
                    <FileUp /> Import from CSV
                  </Link>
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Total records"
              loading={overview.isPending}
              value={formatNumber(overview.data?.totalRecords ?? 0, locale)}
              detail={
                overview.data
                  ? `${formatNumber(overview.data.categoryCount, locale)} categories · ${formatNumber(overview.data.deletedCount, locale)} in trash`
                  : undefined
              }
            />
            <StatTile
              label="Total recorded value"
              info="Sum of unit price × quantity across all active (not deleted) records. Currencies are never combined."
              loading={overview.isPending}
              value={primary ? formatMoney(primary.totalValue, primary.currency, locale) : formatMoney('0', user.settings.defaultCurrency, locale)}
              detail={
                others.length > 0
                  ? `+ ${others.map((entry) => formatMoney(entry.totalValue, entry.currency, locale)).join(' · ')}`
                  : primary
                    ? `${formatNumber(primary.totalQuantity, locale)} units in ${primary.currency}`
                    : undefined
              }
            />
            <StatTile
              label="Average item price"
              info="Mean unit price of active records in this currency, rounded to the currency’s smallest unit."
              loading={overview.isPending}
              value={primary ? formatMoney(primary.averagePrice, primary.currency, locale) : '—'}
              detail={primary ? `Across ${formatNumber(primary.itemCount, locale)} ${primary.currency} records` : undefined}
            />
            <StatTile
              label="Highest-priced item"
              loading={overview.isPending}
              value={primary?.highest ? formatMoney(primary.highest.price, primary.currency, locale) : '—'}
              detail={
                primary?.highest ? (
                  <Link to={`/app/records/${primary.highest.id}`} className="hover:underline">
                    {primary.highest.name}
                  </Link>
                ) : undefined
              }
            />
          </section>

          <section aria-label="Trends" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Trends</h2>
              <RangeFilter
                preset={preset}
                onPresetChange={setPreset}
                currency={chartCurrency}
                currencies={analytics.data?.availableCurrencies}
                onCurrencyChange={setCurrency}
              />
            </div>
            {analytics.isError ? (
              <Card>
                <ErrorState message={errorMessage(analytics.error)} onRetry={() => void analytics.refetch()} />
              </Card>
            ) : (
              <div className="grid gap-4 xl:grid-cols-5">
                <ChartCard
                  className="xl:col-span-3"
                  title="Recorded value over time"
                  description={`Total value of your active ${chartCurrency} records at the end of each ${range.granularity}, rebuilt from record history.`}
                  loading={analytics.isFetching}
                  actions={
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/app/analytics">
                        Details <ArrowRight />
                      </Link>
                    </Button>
                  }
                  table={
                    analytics.data && (
                      <DataTable
                        columns={['Period', 'Value']}
                        rows={analytics.data.collectionValue.map((point) => [
                          formatBucket(point.bucket, analytics.data.granularity, locale),
                          formatMoney(point.value, analytics.data.currency, locale),
                        ])}
                      />
                    )
                  }
                >
                  {analytics.data ? (
                    <ValueAreaChart data={analytics.data.collectionValue} currency={analytics.data.currency} locale={locale} granularity={analytics.data.granularity} />
                  ) : (
                    <Skeleton className="h-[260px]" />
                  )}
                </ChartCard>
                <ChartCard
                  className="xl:col-span-2"
                  title={`Items added per ${range.granularity}`}
                  description="Records created in each period, in all currencies."
                  loading={analytics.isFetching}
                  table={
                    analytics.data && (
                      <DataTable
                        columns={['Period', 'Items added']}
                        rows={analytics.data.itemsAdded.map((point) => [formatBucket(point.bucket, analytics.data.granularity, locale), point.count])}
                      />
                    )
                  }
                >
                  {analytics.data ? (
                    <CountColumnChart data={analytics.data.itemsAdded} locale={locale} granularity={analytics.data.granularity} label="items added" height={260} />
                  ) : (
                    <Skeleton className="h-[260px]" />
                  )}
                </ChartCard>
                <ChartCard
                  className="xl:col-span-3"
                  title="Category distribution"
                  description={`Active records per category, with their ${chartCurrency} value.`}
                  loading={analytics.isFetching}
                >
                  {analytics.data ? (
                    <RankedBars
                      emptyText="No active records yet."
                      rows={analytics.data.categoryDistribution.slice(0, 8).map((entry) => ({
                        key: entry.categoryId ?? 'none',
                        label: entry.name,
                        value: entry.count,
                        display: formatCount(entry.count, 'item', 'items', locale),
                        secondary: isZeroAmount(entry.value) ? undefined : formatMoney(entry.value, analytics.data.currency, locale),
                        color: entry.color,
                      }))}
                    />
                  ) : (
                    <Skeleton className="h-48" />
                  )}
                </ChartCard>
                <ChartCard
                  className="xl:col-span-2"
                  title="Top-priced items"
                  description={`Highest line totals (price × quantity) in ${chartCurrency}.`}
                  loading={analytics.isFetching}
                >
                  {analytics.data ? (
                    <RankedBars
                      emptyText={`No active ${chartCurrency} records.`}
                      rows={analytics.data.topItems.slice(0, 6).map((entry) => ({
                        key: entry.id,
                        label: entry.name,
                        value: Number(entry.lineTotal),
                        display: formatMoney(entry.lineTotal, analytics.data.currency, locale),
                        secondary: entry.quantity > 1 ? `× ${entry.quantity}` : undefined,
                        href: `/app/records/${entry.id}`,
                      }))}
                    />
                  ) : (
                    <Skeleton className="h-48" />
                  )}
                </ChartCard>
              </div>
            )}
          </section>

          <section aria-label="Recent records" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Recently added</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/app/records?sort=createdAt&order=desc">
                    View all <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {overview.isPending ? (
                  <Skeleton className="h-40" />
                ) : (
                  <ItemRowList items={overview.data?.recentlyAdded ?? []} locale={locale} timestamp="createdAt" emptyText="Nothing added yet." />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Recently updated</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/app/records?sort=updatedAt&order=desc">
                    View all <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {overview.isPending ? (
                  <Skeleton className="h-40" />
                ) : (
                  <ItemRowList
                    items={overview.data?.recentlyUpdated ?? []}
                    locale={locale}
                    timestamp="updatedAt"
                    emptyText="Records you edit will appear here."
                  />
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
