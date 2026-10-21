import { CURRENCY_CODES, type CurrencyCode } from '@vaultledger/shared';
import { NativeSelect } from '@/components/ui/input';
import { addDaysIso, todayIso } from '@/lib/utils';

export const RANGE_PRESETS = [
  { value: '7d', label: 'Last 7 days', days: 7, granularity: 'day' },
  { value: '30d', label: 'Last 30 days', days: 30, granularity: 'day' },
  { value: '90d', label: 'Last 90 days', days: 90, granularity: 'week' },
  { value: '12m', label: 'Last 12 months', days: 365, granularity: 'month' },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]['value'];

export function rangeFor(preset: RangePreset) {
  const entry = RANGE_PRESETS.find((option) => option.value === preset) ?? RANGE_PRESETS[1];
  const to = todayIso();
  return { from: addDaysIso(to, -(entry.days - 1)), to, granularity: entry.granularity };
}

/** One row of filters above the charts; every chart below uses the same range and currency. */
export function RangeFilter({
  preset,
  onPresetChange,
  currency,
  currencies,
  onCurrencyChange,
}: {
  preset: RangePreset;
  onPresetChange: (preset: RangePreset) => void;
  currency?: CurrencyCode;
  currencies?: CurrencyCode[];
  onCurrencyChange?: (currency: CurrencyCode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="range-preset">
        Date range
      </label>
      <NativeSelect id="range-preset" className="h-9 w-auto min-w-[10rem]" value={preset} onChange={(event) => onPresetChange(event.target.value as RangePreset)}>
        {RANGE_PRESETS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {onCurrencyChange && currency && (
        <>
          <label className="sr-only" htmlFor="range-currency">
            Currency
          </label>
          <NativeSelect
            id="range-currency"
            className="h-9 w-auto min-w-[7rem]"
            value={currency}
            onChange={(event) => onCurrencyChange(event.target.value as CurrencyCode)}
          >
            {(currencies?.length ? currencies : CURRENCY_CODES).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </NativeSelect>
        </>
      )}
    </div>
  );
}
