/**
 * Escapes one CSV cell (RFC 4180) and neutralises spreadsheet formula
 * injection: values beginning with =, +, -, @, tab or carriage return are
 * prefixed with an apostrophe so spreadsheet apps treat them as text.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: (string | number | null | undefined)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}
