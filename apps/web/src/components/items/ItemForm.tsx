import { zodResolver } from '@hookform/resolvers/zod';
import {
  CURRENCY_CODES,
  ITEM_DESCRIPTION_MAX,
  itemFormSchema,
  minorToDecimalString,
  parseMoney,
  splitTags,
  type CreateItemInput,
  type CurrencyCode,
  type ItemDTO,
  type ItemFormValues,
  type UpdateItemInput,
} from '@vaultledger/shared';
import { Plus, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, type Path } from 'react-hook-form';
import { toast } from 'sonner';
import { CategoryDialog } from '@/components/items/CategoryDialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { useCategories, useCreateItem, useCurrentUser, useUpdateItem } from '@/hooks/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { currencyLabel, currencySymbol, formatDateTime, formatMoney } from '@/lib/format';
import { cn, newRequestKey } from '@/lib/utils';

interface ItemFormProps {
  mode: 'create' | 'edit';
  item?: ItemDTO;
  /** Quick-add shows only the essential fields. */
  compact?: boolean;
  onSaved?: (item: ItemDTO, options: { addAnother: boolean }) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

const FORM_FIELDS = ['name', 'price', 'currency', 'quantity', 'categoryId', 'sku', 'description', 'supplier', 'purchaseDate', 'tags'] as const;

function toFormValues(item: ItemDTO | undefined, defaultCurrency: CurrencyCode, keep?: Partial<ItemFormValues>): ItemFormValues {
  return {
    name: item?.name ?? '',
    price: item?.price ?? '',
    currency: item?.currency ?? keep?.currency ?? defaultCurrency,
    quantity: String(item?.quantity ?? 1),
    categoryId: item?.category?.id ?? keep?.categoryId ?? '',
    sku: item?.sku ?? '',
    description: item?.description ?? '',
    supplier: item?.supplier ?? '',
    purchaseDate: item?.purchaseDate ?? '',
    tags: item?.tags.join(', ') ?? '',
  };
}

function toCreateInput(values: ItemFormValues): CreateItemInput {
  return {
    name: values.name.trim(),
    price: values.price.trim(),
    currency: values.currency,
    quantity: Number(values.quantity),
    categoryId: values.categoryId || null,
    sku: values.sku.trim() || null,
    description: values.description.trim() || null,
    supplier: values.supplier.trim() || null,
    purchaseDate: values.purchaseDate || null,
    tags: splitTags(values.tags),
  };
}

/** Only the fields that actually changed are sent, together with the version for conflict detection. */
function toUpdateInput(values: ItemFormValues, item: ItemDTO): UpdateItemInput {
  const next = toCreateInput(values);
  const patch: UpdateItemInput = { version: item.version };
  if (next.name !== item.name) patch.name = next.name;
  if (next.currency !== item.currency) {
    patch.currency = next.currency;
    patch.price = next.price;
  } else {
    const before = parseMoney(item.price, item.currency);
    const after = parseMoney(next.price, next.currency);
    if (!before.ok || !after.ok || before.minor !== after.minor) patch.price = next.price;
  }
  if (next.quantity !== item.quantity) patch.quantity = next.quantity;
  if ((next.categoryId ?? null) !== (item.category?.id ?? null)) patch.categoryId = next.categoryId ?? null;
  if (next.sku !== item.sku) patch.sku = next.sku;
  if (next.description !== item.description) patch.description = next.description;
  if (next.supplier !== item.supplier) patch.supplier = next.supplier;
  if (next.purchaseDate !== item.purchaseDate) patch.purchaseDate = next.purchaseDate;
  if ((next.tags ?? []).join(',') !== item.tags.join(',')) patch.tags = next.tags;
  return patch;
}

export function ItemForm({ mode, item, compact = false, onSaved, onCancel, autoFocus = true }: ItemFormProps) {
  const user = useCurrentUser();
  const { locale, defaultCurrency, showQuantity } = user.settings;
  const categories = useCategories();
  const createItem = useCreateItem();
  const updateItem = useUpdateItem(item?.id ?? '');
  const requestKey = useRef(newRequestKey());
  const addAnotherRef = useRef(false);
  const [lastSaved, setLastSaved] = useState<ItemDTO | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: toFormValues(item, defaultCurrency),
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, reset, setError, setValue, control, setFocus } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (autoFocus) setFocus('name');
  }, [autoFocus, setFocus]);

  const [price, currency, quantity] = useWatch({ control, name: ['price', 'currency', 'quantity'] });
  const lineTotal = useMemo(() => {
    const parsed = parseMoney(price ?? '', currency);
    const qty = /^\d{1,7}$/.test(quantity ?? '') ? BigInt(quantity) : 0n;
    if (!parsed.ok || qty < 1n) return null;
    return minorToDecimalString(parsed.minor * qty, currency);
  }, [price, currency, quantity]);

  const saving = createItem.isPending || updateItem.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      let saved: ItemDTO;
      if (mode === 'edit' && item) {
        const patch = toUpdateInput(values, item);
        if (Object.keys(patch).length === 1) {
          toast.info('No changes to save.');
          onSaved?.(item, { addAnother: false });
          return;
        }
        saved = await updateItem.mutateAsync(patch);
        toast.success(`Saved changes to “${saved.name}”`, { description: `Updated ${formatDateTime(saved.updatedAt, locale)}` });
      } else {
        saved = await createItem.mutateAsync({ input: toCreateInput(values), requestKey: requestKey.current });
        // A new key for the next record; retries of the same submission reuse the old one.
        requestKey.current = newRequestKey();
        toast.success(`Saved “${saved.name}”`, { description: `Created ${formatDateTime(saved.createdAt, locale)}` });
      }
      const addAnother = addAnotherRef.current;
      if (addAnother) {
        setLastSaved(saved);
        reset(toFormValues(undefined, defaultCurrency, { currency: values.currency, categoryId: values.categoryId }));
        setTimeout(() => setFocus('name'), 0);
      }
      onSaved?.(saved, { addAnother });
    } catch (error) {
      if (isApiError(error)) {
        const fieldEntries = Object.entries(error.fields);
        for (const [key, message] of fieldEntries) {
          const field = (FORM_FIELDS as readonly string[]).find((name) => key === name || key.startsWith(`${name}.`));
          if (field) setError(field as Path<ItemFormValues>, { message });
        }
        if (error.code === 'VERSION_CONFLICT') {
          setFormError('This record was changed somewhere else (perhaps on another device). Reload the page to see the latest version before editing.');
          return;
        }
        if (fieldEntries.length === 0 || error.code !== 'VALIDATION_FAILED') setFormError(error.message);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      addAnotherRef.current = false;
    }
  });

  const symbol = currencySymbol(currency, locale);
  const showQuantityField = showQuantity || mode === 'edit' || !compact;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label={mode === 'edit' ? 'Edit item' : 'Add item'}>
      {formError && <Alert tone="error" title="The item was not saved">{formError}</Alert>}
      {lastSaved && (
        <Alert tone="success" title={`“${lastSaved.name}” saved`}>
          {formatMoney(lastSaved.price, lastSaved.currency, locale)} · created {formatDateTime(lastSaved.createdAt, locale)}. Add the next item below.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-6">
        <Field id="item-name" label="Item name" required error={errors.name?.message} className="sm:col-span-6">
          {(aria) => <Input {...aria} placeholder="e.g. Noise-cancelling headphones" autoComplete="off" maxLength={120} {...register('name')} />}
        </Field>

        <Field id="item-price" label="Unit price" required error={errors.price?.message} className="sm:col-span-3">
          {(aria) => (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">{symbol}</span>
              <Input
                {...aria}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className={cn('tabular', symbol.length > 2 ? 'pl-12' : 'pl-8')}
                {...register('price')}
              />
            </div>
          )}
        </Field>

        <Field id="item-currency" label="Currency" required error={errors.currency?.message} className="sm:col-span-3">
          {(aria) => (
            <NativeSelect {...aria} {...register('currency')}>
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {currencyLabel(code)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        {showQuantityField && (
          <Field
            id="item-quantity"
            label="Quantity"
            error={errors.quantity?.message}
            className="sm:col-span-2"
            hint={lineTotal ? `Line total ${formatMoney(lineTotal, currency, locale)}` : 'Whole number, at least 1'}
          >
            {(aria) => <Input {...aria} inputMode="numeric" autoComplete="off" className="tabular" {...register('quantity')} />}
          </Field>
        )}

        <Field
          id="item-category"
          label="Category"
          error={errors.categoryId?.message}
          className={showQuantityField ? 'sm:col-span-4' : 'sm:col-span-6'}
          labelAside={
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setCategoryDialogOpen(true)}>
              <Plus className="mr-0.5 inline size-3" aria-hidden />
              New category
            </button>
          }
        >
          {(aria) => (
            <NativeSelect {...aria} disabled={categories.isPending} {...register('categoryId')}>
              <option value="">No category</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        {!compact && (
          <>
            <Field id="item-sku" label="SKU / reference" error={errors.sku?.message} className="sm:col-span-3">
              {(aria) => <Input {...aria} autoComplete="off" maxLength={64} placeholder="Optional" {...register('sku')} />}
            </Field>
            <Field id="item-purchase-date" label="Purchase date" error={errors.purchaseDate?.message} className="sm:col-span-3">
              {(aria) => <Input {...aria} type="date" max="9999-12-31" {...register('purchaseDate')} />}
            </Field>
            <Field id="item-supplier" label="Supplier or source" error={errors.supplier?.message} className="sm:col-span-3">
              {(aria) => <Input {...aria} autoComplete="off" maxLength={120} placeholder="Optional" {...register('supplier')} />}
            </Field>
            <Field
              id="item-tags"
              label="Tags"
              error={errors.tags?.message}
              className="sm:col-span-3"
              hint="Separate tags with commas, e.g. office, warranty"
            >
              {(aria) => <Input {...aria} autoComplete="off" placeholder="Optional" {...register('tags')} />}
            </Field>
            <Field
              id="item-description"
              label="Description or notes"
              error={errors.description?.message}
              className="sm:col-span-6"
              hint={`Up to ${ITEM_DESCRIPTION_MAX.toLocaleString()} characters`}
            >
              {(aria) => <Textarea {...aria} rows={3} maxLength={ITEM_DESCRIPTION_MAX} placeholder="Optional" {...register('description')} />}
            </Field>
          </>
        )}
      </div>

      {!compact && (
        <p className="text-xs text-muted-foreground">
          Attachments are not supported yet: files would need secure object storage and malware scanning before they could be accepted.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              reset(toFormValues(item, defaultCurrency));
              setFormError(null);
              setLastSaved(null);
            }}
          >
            <RotateCcw /> Reset form
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {mode === 'create' && (
            <Button
              type="submit"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                addAnotherRef.current = true;
              }}
            >
              <Plus /> Save and add another
            </Button>
          )}
          <Button type="submit" loading={saving}>
            {!saving && <Save />} {mode === 'edit' ? 'Save changes' : 'Save item'}
          </Button>
        </div>
      </div>

      <CategoryDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        onSaved={(category) => setValue('categoryId', category.id, { shouldDirty: true })}
      />
    </form>
  );
}
