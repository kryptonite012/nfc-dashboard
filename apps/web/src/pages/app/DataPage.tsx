import { CURRENCY_CODES, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, type CurrencyCode, type ImportResultDTO } from '@vaultledger/shared';
import { CheckCircle2, Download, FileJson, FileText, FileUp, Sheet, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, PageHeader } from '@/components/ui/feedback';
import { NativeSelect } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Label } from '@/components/ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfig, useCurrentUser, useImport } from '@/hooks/queries';
import { downloadFile, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';

const TEMPLATE = [
  'name,price,currency,quantity,category,sku,description,supplier,purchase_date,tags',
  'Wireless mouse,1299.00,INR,2,Electronics,WM-204,"Ergonomic, 2.4 GHz",Croma,2026-03-14,office;peripherals',
  'Coffee beans 1kg,850,INR,1,Kitchen,,,Local roaster,,',
].join('\r\n');

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([`\uFEFF${TEMPLATE}\r\n`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vaultledger-import-template.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DataPage() {
  const user = useCurrentUser();
  const { locale } = user.settings;
  const importer = useImport();
  const pdfExport = useConfig().data?.features.pdfExport ?? false;
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportResultDTO | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(user.settings.defaultCurrency);
  const [createCategories, setCreateCategories] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runExport = async (key: string, path: string, query: Record<string, string>, fallback: string) => {
    setBusy(key);
    try {
      await downloadFile(path, query, fallback);
      toast.success('Download started');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (selected: File | undefined) => {
    setFileError(null);
    setPreview(null);
    setFile(null);
    if (!selected) return;
    if (!/\.csv$/i.test(selected.name) && selected.type !== 'text/csv') {
      setFileError('Choose a .csv file.');
      return;
    }
    if (selected.size > IMPORT_MAX_BYTES) {
      setFileError('The file is larger than 1 MB. Split it into smaller files.');
      return;
    }
    const text = await selected.text();
    setFile({ name: selected.name, text });
    try {
      const result = await importer.mutateAsync({ csv: text, commit: false, defaultCurrency, createMissingCategories: createCategories });
      setPreview(result);
    } catch (error) {
      setFileError(errorMessage(error));
    }
  };

  const reviewAgain = async () => {
    if (!file) return;
    try {
      setPreview(await importer.mutateAsync({ csv: file.text, commit: false, defaultCurrency, createMissingCategories: createCategories }));
    } catch (error) {
      setFileError(errorMessage(error));
    }
  };

  const commit = async () => {
    if (!file) return;
    try {
      const result = await importer.mutateAsync({ csv: file.text, commit: true, defaultCurrency, createMissingCategories: createCategories });
      setPreview(result);
      toast.success(`Imported ${result.createdCount} record(s)`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setFileError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Import / Export" description="Move your records in and out of VaultLedger." />

      <div className={pdfExport ? 'grid gap-4 lg:grid-cols-3' : 'grid gap-4 lg:grid-cols-2'}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sheet className="size-4 text-primary" aria-hidden /> CSV export
            </CardTitle>
            <CardDescription>All active records as a spreadsheet. Exact amounts, UTF-8, Excel-safe.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" loading={busy === 'csv'} onClick={() => void runExport('csv', '/api/data/export', { format: 'csv' }, 'vaultledger-records.csv')}>
              <Download /> Download CSV
            </Button>
          </CardContent>
        </Card>
        {pdfExport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden /> PDF report
            </CardTitle>
            <CardDescription>A printable summary with totals per currency and up to 2,000 records.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" loading={busy === 'pdf'} onClick={() => void runExport('pdf', '/api/data/export', { format: 'pdf' }, 'vaultledger-records.pdf')}>
              <Download /> Download PDF
            </Button>
          </CardContent>
        </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="size-4 text-primary" aria-hidden /> Full account export
            </CardTitle>
            <CardDescription>Everything we store about you, including trash and price history, as JSON.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" loading={busy === 'json'} onClick={() => void runExport('json', '/api/data/account-export', {}, 'vaultledger-account.json')}>
              <Download /> Download JSON
            </Button>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        To export a filtered selection, use <strong>Export</strong> on <Link to="/app/records" className="text-primary hover:underline">All Records</Link>.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="size-4 text-primary" aria-hidden /> Import from CSV
          </CardTitle>
          <CardDescription>
            Required columns: <code>name</code> and <code>price</code>. Optional: currency, quantity, category, sku, description, supplier,
            purchase_date (YYYY-MM-DD) and tags (separated by semicolons). Up to {formatNumber(IMPORT_MAX_ROWS, locale)} rows and 1 MB per file.
            Nothing is saved until you confirm.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="import-currency">Currency for rows without one</Label>
              <NativeSelect id="import-currency" value={defaultCurrency} onChange={(event) => setDefaultCurrency(event.target.value as CurrencyCode)}>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-2 sm:pt-6">
              <Checkbox id="import-categories" checked={createCategories} onCheckedChange={(checked) => setCreateCategories(checked === true)} />
              <Label htmlFor="import-categories" className="font-normal">
                Create categories that don’t exist yet
              </Label>
            </div>
            <div className="flex items-center sm:pt-6">
              <Button variant="link" className="h-auto p-0" onClick={downloadTemplate}>
                Download a template CSV
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-dashed p-6 text-center">
            <input
              ref={fileInput}
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
            <FileUp className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">{file ? file.name : 'Choose a CSV file to check'}</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button asChild variant="outline" size="sm">
                <label htmlFor="import-file" className="cursor-pointer">
                  {file ? 'Choose another file' : 'Choose file'}
                </label>
              </Button>
              {file && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          {fileError && <Alert tone="error" title="The file can’t be imported">{fileError}</Alert>}
          {importer.isPending && !preview && <p className="text-sm text-muted-foreground" role="status">Checking the file…</p>}

          {preview && (
            <div className="space-y-4">
              {preview.committed ? (
                <Alert
                  tone="success"
                  title={`Imported ${formatNumber(preview.createdCount, locale)} record(s)`}
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/records">View records</Link>
                    </Button>
                  }
                >
                  {preview.invalidRows > 0 && `${preview.invalidRows} invalid row(s) were skipped. `}
                  {preview.createdCategories.length > 0 && `New categories: ${preview.createdCategories.join(', ')}.`}
                </Alert>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary">{formatNumber(preview.totalRows, locale)} rows</Badge>
                    <Badge variant="success">{formatNumber(preview.validRows, locale)} ready</Badge>
                    {preview.invalidRows > 0 && <Badge variant="destructive">{formatNumber(preview.invalidRows, locale)} with errors</Badge>}
                    {preview.createdCategories.length > 0 && <Badge variant="outline">{preview.createdCategories.length} new categories</Badge>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void reviewAgain()} disabled={importer.isPending}>
                      Re-check with these options
                    </Button>
                    <Button size="sm" onClick={() => void commit()} loading={importer.isPending} disabled={preview.validRows === 0}>
                      Import {formatNumber(preview.validRows, locale)} valid row{preview.validRows === 1 ? '' : 's'}
                    </Button>
                  </div>
                </div>
              )}
              {preview.invalidRows > 0 && !preview.committed && (
                <p className="text-sm text-muted-foreground">Rows with errors are skipped. Fix them in your file and import again if needed.</p>
              )}
              <div className="max-h-96 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell className="tabular">{row.row}</TableCell>
                        <TableCell>
                          {row.status === 'ok' ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CheckCircle2 className="size-4" aria-hidden /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <XCircle className="size-4" aria-hidden /> Error
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[14rem] truncate">{row.name ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.status === 'ok' ? `${row.price} ${row.currency}` : row.errors?.join('; ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">The preview lists every row with an error and the first 50 valid rows.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
