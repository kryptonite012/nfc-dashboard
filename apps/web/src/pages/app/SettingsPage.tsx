import { CURRENCY_CODES, LOCALES, type SettingsInput, type ThemePreference } from '@vaultledger/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/feedback';
import { NativeSelect } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Label, Switch } from '@/components/ui/primitives';
import { useCurrentUser, useUpdateSettings } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { currencyLabel, formatDateTime, formatMoney } from '@/lib/format';
import { useTheme } from '@/lib/theme';

const LOCALE_LABELS: Record<(typeof LOCALES)[number], string> = {
  'en-IN': 'English (India) — 1,23,456.00',
  'en-US': 'English (United States) — 123,456.00',
  'en-GB': 'English (United Kingdom) — 123,456.00',
  'de-DE': 'Deutsch — 123.456,00',
  'fr-FR': 'Français — 123 456,00',
  'ja-JP': '日本語 — 123,456.00',
};

export default function SettingsPage() {
  const user = useCurrentUser();
  const update = useUpdateSettings();
  const { setTheme } = useTheme();
  const [values, setValues] = useState<SettingsInput>(user.settings);
  useEffect(() => setValues(user.settings), [user.settings]);

  const dirty = (Object.keys(values) as (keyof SettingsInput)[]).some((key) => values[key] !== user.settings[key]);

  const save = async () => {
    try {
      await update.mutateAsync(values);
      setTheme(values.theme as ThemePreference);
      toast.success('Settings saved');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Preferences are saved to your account and follow you to every device." />
      <Card>
        <CardHeader>
          <CardTitle>Money and formatting</CardTitle>
          <CardDescription>Your default currency is pre-selected for new items and shown first on the dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="default-currency">Default currency</Label>
              <NativeSelect
                id="default-currency"
                value={values.defaultCurrency}
                onChange={(event) => setValues((current) => ({ ...current, defaultCurrency: event.target.value as SettingsInput['defaultCurrency'] }))}
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {currencyLabel(code)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="locale">Number and date format</Label>
              <NativeSelect
                id="locale"
                value={values.locale}
                onChange={(event) => setValues((current) => ({ ...current, locale: event.target.value as SettingsInput['locale'] }))}
              >
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_LABELS[locale]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            Preview: <span className="font-medium text-foreground">{formatMoney('123456.78', values.defaultCurrency, values.locale)}</span> ·{' '}
            {formatDateTime(new Date().toISOString(), values.locale)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance and records</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="theme">Theme</Label>
            <NativeSelect
              id="theme"
              className="sm:w-60"
              value={values.theme}
              onChange={(event) => setValues((current) => ({ ...current, theme: event.target.value as ThemePreference }))}
            >
              <option value="system">Match my device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </NativeSelect>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="show-quantity">Show quantity</Label>
              <p className="text-sm text-muted-foreground">Display the quantity column in tables and the quantity field in quick add.</p>
            </div>
            <Switch id="show-quantity" checked={values.showQuantity} onCheckedChange={(checked) => setValues((current) => ({ ...current, showQuantity: checked }))} />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button variant="ghost" disabled={!dirty || update.isPending} onClick={() => setValues(user.settings)}>
            Discard
          </Button>
          <Button onClick={() => void save()} loading={update.isPending} disabled={!dirty}>
            Save settings
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
