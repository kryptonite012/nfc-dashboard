import type { CategoryColor, CurrencyCode, SupportedLocale } from '@vaultledger/shared';
import { Table2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CategoryDot } from '@/components/items/CategoryBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBucket, formatMoney, formatMoneyCompact, formatNumber } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Reads the chart tokens from CSS so charts follow the active theme. */
export function useChartColors() {
  const { resolved } = useTheme();
  const [colors, setColors] = useState(() => readColors());
  useEffect(() => setColors(readColors()), [resolved]);
  return colors;
}

function readColors() {
  const style = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => {
    const value = style?.getPropertyValue(`--${name}`).trim();
    return value ? `rgb(${value.split(/\s+/).join(',')})` : fallback;
  };
  return {
    series1: get('chart-1', '#2a78d6'),
    series2: get('chart-2', '#eb6834'),
    series3: get('chart-3', '#1baf7a'),
    grid: get('chart-grid', '#e8eaf0'),
    axis: get('chart-axis', '#787e8c'),
    surface: get('card', '#ffffff'),
  };
}

interface ChartCardProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  table?: ReactNode;
  className?: string;
  loading?: boolean;
  actions?: ReactNode;
}

/** Card with an accessible "view as table" alternative for every chart. */
export function ChartCard({ title, description, children, table, className, loading, actions }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && (
            <Button variant="ghost" size="sm" aria-pressed={showTable} onClick={() => setShowTable((value) => !value)}>
              <Table2 /> {showTable ? 'Chart' : 'Table'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className={cn('flex-1 transition-opacity', loading && 'opacity-60')}>{showTable && table ? table : children}</CardContent>
    </Card>
  );
}

interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color: string;
}

function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-[10rem] rounded-md border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="tabular font-semibold text-foreground">{row.value}</span>
            <span className="text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const axisProps = (color: string) => ({
  tick: { fill: color, fontSize: 11 },
  tickLine: false,
  axisLine: false,
});

export interface ValuePoint {
  bucket: string;
  value: string;
}

/** Collection value over time: one series, 2px line with a 10% area wash and a crosshair tooltip. */
export function ValueAreaChart({
  data,
  currency,
  locale,
  granularity,
  height = 260,
}: {
  data: ValuePoint[];
  currency: CurrencyCode;
  locale: SupportedLocale;
  granularity: 'day' | 'week' | 'month';
  height?: number;
}) {
  const colors = useChartColors();
  const rows = useMemo(() => data.map((point) => ({ ...point, plot: Number(point.value) })), [data]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={colors.grid} />
        <XAxis dataKey="bucket" {...axisProps(colors.axis)} minTickGap={24} tickFormatter={(value: string) => formatBucket(value, granularity, locale)} />
        <YAxis {...axisProps(colors.axis)} width={64} tickFormatter={(value: number) => formatMoneyCompact(value, currency, locale)} />
        <ChartTooltip
          cursor={{ stroke: colors.axis, strokeWidth: 1 }}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
            if (!point) return null;
            return (
              <TooltipBox
                title={formatBucket(point.bucket, granularity, locale)}
                rows={[{ key: 'value', label: 'collection value', value: formatMoney(point.value, currency, locale), color: colors.series1 }]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="plot"
          stroke={colors.series1}
          strokeWidth={2}
          fill={colors.series1}
          fillOpacity={0.1}
          activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2, fill: colors.series1 }}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Single-series column chart for counts (items added per bucket). */
export function CountColumnChart({
  data,
  locale,
  granularity,
  label,
  height = 220,
}: {
  data: { bucket: string; count: number }[];
  locale: SupportedLocale;
  granularity: 'day' | 'week' | 'month';
  label: string;
  height?: number;
}) {
  const colors = useChartColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={colors.grid} />
        <XAxis dataKey="bucket" {...axisProps(colors.axis)} minTickGap={24} tickFormatter={(value: string) => formatBucket(value, granularity, locale)} />
        <YAxis {...axisProps(colors.axis)} width={40} allowDecimals={false} />
        <ChartTooltip
          cursor={{ fill: colors.grid, opacity: 0.5 }}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as { bucket: string; count: number } | undefined) : undefined;
            if (!point) return null;
            return (
              <TooltipBox
                title={formatBucket(point.bucket, granularity, locale)}
                rows={[{ key: 'count', label, value: formatNumber(point.count, locale), color: colors.series1 }]}
              />
            );
          }}
        />
        <Bar dataKey="count" fill={colors.series1} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Additions, removals and re-pricing per bucket: diverging stacked columns around a zero baseline. */
export function ValueChangesChart({
  data,
  currency,
  locale,
  granularity,
  height = 260,
}: {
  data: { bucket: string; additions: string; removals: string; repricing: string }[];
  currency: CurrencyCode;
  locale: SupportedLocale;
  granularity: 'day' | 'week' | 'month';
  height?: number;
}) {
  const colors = useChartColors();
  const series = [
    { key: 'additions', label: 'Added', color: colors.series1 },
    { key: 'removals', label: 'Removed', color: colors.series2 },
    { key: 'repricing', label: 'Re-priced', color: colors.series3 },
  ] as const;
  const rows = useMemo(
    () => data.map((row) => ({ ...row, a: Number(row.additions), r: Number(row.removals), p: Number(row.repricing) })),
    [data],
  );
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </li>
        ))}
      </ul>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={colors.grid} />
          <XAxis dataKey="bucket" {...axisProps(colors.axis)} minTickGap={24} tickFormatter={(value: string) => formatBucket(value, granularity, locale)} />
          <YAxis {...axisProps(colors.axis)} width={64} tickFormatter={(value: number) => formatMoneyCompact(value, currency, locale)} />
          <ReferenceLine y={0} stroke={colors.axis} />
          <ChartTooltip
            cursor={{ fill: colors.grid, opacity: 0.5 }}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
              if (!point) return null;
              return (
                <TooltipBox
                  title={formatBucket(point.bucket, granularity, locale)}
                  rows={series.map((entry) => ({
                    key: entry.key,
                    label: entry.label.toLowerCase(),
                    value: formatMoney(point[entry.key], currency, locale),
                    color: entry.color,
                  }))}
                />
              );
            }}
          />
          <Bar dataKey="a" stackId="v" fill={colors.series1} maxBarSize={24} stroke={colors.surface} strokeWidth={1} isAnimationActive={false} />
          <Bar dataKey="r" stackId="v" fill={colors.series2} maxBarSize={24} stroke={colors.surface} strokeWidth={1} isAnimationActive={false} />
          <Bar dataKey="p" stackId="v" fill={colors.series3} maxBarSize={24} stroke={colors.surface} strokeWidth={1} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars rendered in HTML, so labels and values are always readable text. */
export function RankedBars({
  rows,
  emptyText,
}: {
  rows: { key: string; label: string; value: number; display: string; secondary?: string; color?: CategoryColor | null; href?: string }[];
  emptyText: string;
}) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(...rows.map((row) => row.value), 0) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {row.color !== undefined && <CategoryDot color={row.color} />}
              {row.href ? (
                <Link to={row.href} className="truncate hover:underline">
                  {row.label}
                </Link>
              ) : (
                <span className="truncate">{row.label}</span>
              )}
            </span>
            <span className="tabular shrink-0 font-medium">
              {row.display}
              {row.secondary && <span className="ml-1.5 font-normal text-muted-foreground">{row.secondary}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted" aria-hidden>
            <div className="h-2 rounded-full bg-chart-1" style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Simple accessible table used as the alternative view for charts. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead key={column} className={index > 0 ? 'text-right' : undefined}>
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, index) => (
                <TableCell key={index} className={cn('py-2', index > 0 && 'tabular text-right')}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
