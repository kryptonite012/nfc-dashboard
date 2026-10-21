import { CURRENCY_CODES, type CurrencyCode, type ItemDTO } from '@vaultledger/shared';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  SearchX,
  Sheet,
  Table2,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CategoryBadge } from '@/components/items/CategoryBadge';
import { useQuickAdd } from '@/components/items/QuickAdd';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/feedback';
import { Input, NativeSelect } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Badge, Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCategories, useConfig, useCurrentUser, useItems, type ItemListParams } from '@/hooks/queries';
import { useItemActions } from '@/hooks/useItemActions';
import { downloadFile, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { browserTimeZone, cn } from '@/lib/utils';

const SORTS = ['name', 'price', 'createdAt', 'updatedAt'] as const;
const PAGE_SIZES = [10, 20, 50, 100];
const FILTER_KEYS = ['q', 'categoryId', 'currency', 'minPrice', 'maxPrice', 'from', 'to', 'tag'] as const;

/** Filters, sorting and pagination live in the URL, so they survive navigation and can be bookmarked. */
function useListParams(): [ItemListParams, (changes: Partial<Record<string, string | number | undefined>>) => void] {
  const [search, setSearch] = useSearchParams();
  const params = useMemo<ItemListParams>(() => {
    const sort = search.get('sort');
    const pageSize = Number(search.get('pageSize'));
    return {
      page: Math.max(1, Number(search.get('page')) || 1),
      pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
      sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as ItemListParams['sort']) : 'createdAt',
      order: search.get('order') === 'asc' ? 'asc' : 'desc',
      status: search.get('status') === 'deleted' ? 'deleted' : 'active',
      q: search.get('q') ?? undefined,
      categoryId: search.get('categoryId') ?? undefined,
      currency: search.get('currency') ?? undefined,
      minPrice: search.get('minPrice') ?? undefined,
      maxPrice: search.get('maxPrice') ?? undefined,
      from: search.get('from') ?? undefined,
      to: search.get('to') ?? undefined,
      tag: search.get('tag') ?? undefined,
      tz: browserTimeZone(),
    };
  }, [search]);

  const update = (changes: Partial<Record<string, string | number | undefined>>) => {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined || value === '') next.delete(key);
          else next.set(key, String(value));
        }
        // Any change other than paging returns to the first page.
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  return [params, update];
}

function SortHeader({
  label,
  field,
  params,
  onSort,
  className,
}: {
  label: string;
  field: ItemListParams['sort'];
  params: ItemListParams;
  onSort: (field: ItemListParams['sort']) => void;
  className?: string;
}) {
  const active = params.sort === field;
  const Icon = !active ? ArrowUpDown : params.order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (params.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-foreground', active && 'text-foreground')}
      >
        {label}
        <Icon className="size-3.5" aria-hidden />
      </button>
    </TableHead>
  );
}

export default function RecordsPage() {
  const user = useCurrentUser();
  const { locale, showQuantity } = user.settings;
  const navigate = useNavigate();
  const quickAdd = useQuickAdd();
  const [params, update] = useListParams();
  const items = useItems(params);
  const categories = useCategories();
  const pdfExport = useConfig().data?.features.pdfExport ?? false;
  const actions = useItemActions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: 'trash' | 'purge'; items: ItemDTO[] } | null>(null);
  const [searchText, setSearchText] = useState(params.q ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const trash = params.status === 'deleted';
  const rows = items.data?.data ?? [];
  const meta = items.data?.meta;
  const activeFilterCount = FILTER_KEYS.filter((key) => key !== 'q' && params[key]).length;

  // Debounce typing into the URL.
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((params.q ?? '') !== searchText.trim()) update({ q: searchText.trim() || undefined });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  useEffect(() => setSearchText(params.q ?? ''), [params.q]);

  // Selection never carries over to a different page or filter.
  const selectionScope = JSON.stringify({ ...params, tz: undefined });
  useEffect(() => setSelected(new Set()), [selectionScope]);

  const onSort = (field: ItemListParams['sort']) => {
    if (params.sort === field) update({ order: params.order === 'asc' ? 'desc' : 'asc' });
    else update({ sort: field, order: field === 'name' ? 'asc' : 'desc' });
  };

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = rows.some((row) => selected.has(row.id));
  const selectedItems = rows.filter((row) => selected.has(row.id));

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const clearFilters = () => {
    setSearchText('');
    update(Object.fromEntries(FILTER_KEYS.map((key) => [key, undefined])));
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const ids = confirm.items.map((item) => item.id);
    if (confirm.kind === 'trash') await actions.moveToTrash(confirm.items);
    else await actions.purge(ids);
    setSelected(new Set());
    setConfirm(null);
  };

  const exportAs = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const { page: _page, pageSize: _pageSize, ...filters } = params;
      await downloadFile('/api/data/export', { ...filters, format }, `vaultledger-records.${format}`);
      toast.success(`${format.toUpperCase()} export downloaded`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const filterControls = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      <div className="space-y-1">
        <label htmlFor="filter-category" className="text-xs font-medium text-muted-foreground">
          Category
        </label>
        <NativeSelect id="filter-category" className="h-9" value={params.categoryId ?? ''} onChange={(event) => update({ categoryId: event.target.value })}>
          <option value="">All categories</option>
          <option value="none">Uncategorised</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <label htmlFor="filter-currency" className="text-xs font-medium text-muted-foreground">
          Currency
        </label>
        <NativeSelect
          id="filter-currency"
          className="h-9"
          value={params.currency ?? ''}
          onChange={(event) =>
            update(event.target.value ? { currency: event.target.value } : { currency: undefined, minPrice: undefined, maxPrice: undefined })
          }
        >
          <option value="">All currencies</option>
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <label htmlFor="filter-min" className="text-xs font-medium text-muted-foreground">
          Min price {params.currency ? `(${params.currency})` : ''}
        </label>
        <Input
          id="filter-min"
          className="h-9 tabular"
          inputMode="decimal"
          disabled={!params.currency}
          placeholder={params.currency ? '0' : 'Choose a currency'}
          defaultValue={params.minPrice ?? ''}
          key={`min-${params.minPrice ?? ''}-${params.currency ?? ''}`}
          onBlur={(event) => update({ minPrice: event.target.value.trim() || undefined })}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="filter-max" className="text-xs font-medium text-muted-foreground">
          Max price {params.currency ? `(${params.currency})` : ''}
        </label>
        <Input
          id="filter-max"
          className="h-9 tabular"
          inputMode="decimal"
          disabled={!params.currency}
          placeholder={params.currency ? 'Any' : 'Choose a currency'}
          defaultValue={params.maxPrice ?? ''}
          key={`max-${params.maxPrice ?? ''}-${params.currency ?? ''}`}
          onBlur={(event) => update({ maxPrice: event.target.value.trim() || undefined })}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="filter-from" className="text-xs font-medium text-muted-foreground">
          Added from
        </label>
        <Input id="filter-from" type="date" className="h-9" value={params.from ?? ''} max={params.to} onChange={(event) => update({ from: event.target.value })} />
      </div>
      <div className="space-y-1">
        <label htmlFor="filter-to" className="text-xs font-medium text-muted-foreground">
          Added to
        </label>
        <Input id="filter-to" type="date" className="h-9" value={params.to ?? ''} min={params.from} onChange={(event) => update({ to: event.target.value })} />
      </div>
    </div>
  );

  const itemMenu = (item: ItemDTO) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate(`/app/records/${item.id}`)}>
          <Eye /> View details
        </DropdownMenuItem>
        {trash ? (
          <>
            <DropdownMenuItem onSelect={() => void actions.restore([item.id])}>
              <RotateCcw /> Restore
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: 'purge', items: [item] })}>
              <Trash2 /> Delete permanently
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => navigate(`/app/records/${item.id}/edit`)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: 'trash', items: [item] })}>
              <Trash2 /> Move to trash
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const hasFilters = Boolean(params.q) || activeFilterCount > 0;
  const firstRow = meta ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const lastRow = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="All Records"
        description="Search, sort and manage every item you have saved."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" loading={exporting !== null}>
                  {!exporting && <Download />} Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export the current filtered view</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void exportAs('csv')}>
                  <Sheet /> CSV (spreadsheet)
                </DropdownMenuItem>
                {pdfExport && (
                  <DropdownMenuItem onSelect={() => void exportAs('pdf')}>
                    <FileText /> PDF report
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={quickAdd.open}>
              <Plus /> Add item
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b" role="tablist" aria-label="Record status">
        {(['active', 'deleted'] as const).map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={params.status === status}
            onClick={() => update({ status: status === 'active' ? undefined : status })}
            className={cn(
              '-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors',
              params.status === status ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {status === 'active' ? 'Active records' : 'Trash'}
          </button>
        ))}
      </div>

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor="records-search" className="sr-only">
              Search records
            </label>
            <Input
              id="records-search"
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search by name, SKU, description, supplier or tag"
              maxLength={100}
              className="h-9"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters} aria-controls="records-filters">
              <Filter /> Filters
              {activeFilterCount > 0 && <Badge className="ml-1">{activeFilterCount}</Badge>}
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X /> Clear
              </Button>
            )}
          </div>
        </div>
        {(showFilters || activeFilterCount > 0) && (
          <div id="records-filters" className="mt-4 border-t pt-4">
            {filterControls}
            {params.tag && (
              <p className="mt-3 flex items-center gap-2 text-sm">
                <Tag className="size-3.5" aria-hidden /> Tag: <Badge variant="secondary">{params.tag}</Badge>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => update({ tag: undefined })}>
                  remove
                </button>
              </p>
            )}
          </div>
        )}
      </Card>

      {someSelected && (
        <div className="sticky top-[4.5rem] z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-card" role="region" aria-label="Bulk actions">
          <span className="mr-2 text-sm font-medium">{selected.size} selected</span>
          {trash ? (
            <>
              <Button size="sm" variant="outline" disabled={actions.pending} onClick={() => void actions.restore([...selected]).then(() => setSelected(new Set()))}>
                <RotateCcw /> Restore
              </Button>
              <Button size="sm" variant="destructive" disabled={actions.pending} onClick={() => setConfirm({ kind: 'purge', items: selectedItems })}>
                <Trash2 /> Delete permanently
              </Button>
            </>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={actions.pending}>
                    <Tag /> Set category
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => void actions.setCategory([...selected], null).then(() => setSelected(new Set()))}>
                    No category
                  </DropdownMenuItem>
                  {categories.data?.map((category) => (
                    <DropdownMenuItem
                      key={category.id}
                      onSelect={() => void actions.setCategory([...selected], category.id).then(() => setSelected(new Set()))}
                    >
                      {category.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="destructive" disabled={actions.pending} onClick={() => setConfirm({ kind: 'trash', items: selectedItems })}>
                <Trash2 /> Move to trash
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {items.isError ? (
          <ErrorState message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
        ) : items.isPending ? (
          <div className="space-y-3 p-4" aria-busy aria-label="Loading records">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={SearchX}
              title="No records match these filters"
              description="Try a different search term or clear the filters."
              action={
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : trash ? (
            <EmptyState icon={Trash2} title="Trash is empty" description="Records you delete appear here, where you can restore them or remove them permanently." />
          ) : (
            <EmptyState
              icon={Table2}
              title="No records yet"
              description="Add your first item to see it here."
              action={
                <Button onClick={quickAdd.open}>
                  <Plus /> Add an item
                </Button>
              }
            />
          )
        ) : (
          <div className={cn('transition-opacity', items.isPlaceholderData && 'opacity-60')}>
            {/* Desktop and tablet: full table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all records on this page"
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(checked) => setSelected(checked === true ? new Set(rows.map((row) => row.id)) : new Set())}
                      />
                    </TableHead>
                    <SortHeader label="Item name" field="name" params={params} onSort={onSort} />
                    <SortHeader label="Price" field="price" params={params} onSort={onSort} className="text-right" />
                    <TableHead>Currency</TableHead>
                    {showQuantity && <TableHead className="text-right">Qty</TableHead>}
                    <TableHead>Category</TableHead>
                    <SortHeader label="Created" field="createdAt" params={params} onSort={onSort} />
                    <SortHeader label={trash ? 'Deleted' : 'Last updated'} field="updatedAt" params={params} onSort={onSort} />
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.id} data-state={selected.has(item.id) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${item.name}`}
                          checked={selected.has(item.id)}
                          onCheckedChange={(checked) => toggle(item.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell className="max-w-[18rem]">
                        <Link to={`/app/records/${item.id}`} className="block truncate font-medium hover:underline">
                          {item.name}
                        </Link>
                        {(item.sku || item.tags.length > 0) && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {[item.sku, ...item.tags.map((tag) => `#${tag}`)].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap text-right font-medium">{formatMoney(item.price, item.currency, locale)}</TableCell>
                      <TableCell className="text-muted-foreground">{item.currency}</TableCell>
                      {showQuantity && <TableCell className="tabular text-right">{formatNumber(item.quantity, locale)}</TableCell>}
                      <TableCell>
                        <CategoryBadge category={item.category} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(item.createdAt, locale)}>
                        {formatDate(item.createdAt, locale)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(item.deletedAt ?? item.updatedAt, locale)}>
                        {formatDate(item.deletedAt ?? item.updatedAt, locale)}
                      </TableCell>
                      <TableCell>{itemMenu(item)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: one card per record */}
            <ul className="divide-y md:hidden">
              {rows.map((item) => (
                <li key={item.id} className="flex items-start gap-3 p-4" data-state={selected.has(item.id) ? 'selected' : undefined}>
                  <Checkbox className="mt-1" aria-label={`Select ${item.name}`} checked={selected.has(item.id)} onCheckedChange={(checked) => toggle(item.id, checked === true)} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/app/records/${item.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {item.name}
                      </Link>
                      <span className="tabular shrink-0 font-semibold">{formatMoney(item.price, item.currency, locale)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {item.category && <CategoryBadge category={item.category} />}
                      {showQuantity && <span>Qty {formatNumber(item.quantity, locale)}</span>}
                      <span>Added {formatDate(item.createdAt, locale)}</span>
                    </div>
                  </div>
                  {itemMenu(item)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground" aria-live="polite">
              Showing <span className="font-medium text-foreground">{formatNumber(firstRow, locale)}</span>–
              <span className="font-medium text-foreground">{formatNumber(lastRow, locale)}</span> of{' '}
              <span className="font-medium text-foreground">{formatNumber(meta.total, locale)}</span>
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="page-size" className="text-muted-foreground">
                Rows
              </label>
              <NativeSelect id="page-size" className="h-9 w-20" value={params.pageSize} onChange={(event) => update({ pageSize: event.target.value })}>
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </NativeSelect>
              <Button variant="outline" size="icon-sm" disabled={meta.page <= 1} onClick={() => update({ page: meta.page - 1 })} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular min-w-[4.5rem] text-center">
                {meta.page} / {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => update({ page: meta.page + 1 })}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        destructive
        loading={actions.pending}
        title={
          confirm?.kind === 'purge'
            ? `Permanently delete ${confirm.items.length === 1 ? 'this record' : `${confirm.items.length} records`}?`
            : `Move ${confirm?.items.length === 1 ? 'this record' : `${confirm?.items.length ?? 0} records`} to trash?`
        }
        description={
          confirm?.kind === 'purge'
            ? 'This cannot be undone. The records and their price history will be erased. Your value history keeps the changes they caused.'
            : 'Trashed records no longer count towards your totals. You can restore them from the trash at any time.'
        }
        confirmLabel={confirm?.kind === 'purge' ? 'Delete permanently' : 'Move to trash'}
        onConfirm={() => void runConfirm()}
      >
        {confirm && confirm.items.length <= 5 && (
          <ul className="rounded-md border bg-muted/40 p-3 text-sm">
            {confirm.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="truncate">{item.name}</span>
                <span className="tabular shrink-0 text-muted-foreground">{formatMoney(item.price, item.currency as CurrencyCode, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </div>
  );
}
