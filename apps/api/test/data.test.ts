import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { createSignedInUser, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('CSV export', () => {
  it('exports only the signed-in user’s records and neutralises formulas', async () => {
    const client = await createSignedInUser('export@example.com');
    const other = await createSignedInUser('other@example.com');
    await client.post('/api/items', { name: '=HYPERLINK("http://evil")', price: '10', currency: 'INR' });
    await client.post('/api/items', { name: 'Plain, "quoted"', price: '20.5', currency: 'INR' });
    await other.post('/api/items', { name: 'Not yours', price: '1', currency: 'INR' });

    const res = await client.get('/api/data/export?format=csv&sort=name&order=asc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="vaultledger-records-/);
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^"'=HYPERLINK\(""http:\/\/evil""\)",10\.00,INR,1,10\.00/);
    expect(lines[2]).toMatch(/^"Plain, ""quoted""",20\.50,INR/);
    expect(res.text).not.toContain('Not yours');
  });

  it('produces a PDF report', async () => {
    const client = await createSignedInUser('pdf@example.com');
    await client.post('/api/items', { name: 'Item', price: '10', currency: 'INR' });
    const res = await client.get('/api/data/export?format=pdf').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});

describe('CSV import', () => {
  const csv = [
    'Item name,Unit price,Currency,Qty,Category,Tags,Purchase date',
    'Pen,₹10.50,INR,10,Stationery,office;blue,2026-01-15',
    'Broken,-5,INR,1,,,',
    'Notebook,45,,2,stationery,,',
    'Bad date,1,INR,1,,,2026-13-40',
  ].join('\n');

  it('previews without writing anything', async () => {
    const client = await createSignedInUser('preview@example.com');
    const res = await client.post('/api/data/import', { csv, commit: false, defaultCurrency: 'INR' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ committed: false, totalRows: 4, validRows: 2, invalidRows: 2, createdCategories: ['Stationery'] });
    expect(await prisma.item.count()).toBe(0);
    expect(await prisma.category.count()).toBe(0);
  });

  it('imports valid rows in one transaction with history and ledger entries', async () => {
    const client = await createSignedInUser('commit@example.com');
    const res = await client.post('/api/data/import', { csv, commit: true, defaultCurrency: 'INR' });
    expect(res.body.data).toMatchObject({ committed: true, createdCount: 2 });

    const items = (await client.get('/api/items?sort=name&order=asc')).body.data;
    expect(items.map((item: { name: string }) => item.name)).toEqual(['Notebook', 'Pen']);
    expect(items[1]).toMatchObject({ price: '10.50', quantity: 10, tags: ['office', 'blue'], purchaseDate: '2026-01-15' });
    expect(items[0].category.name).toBe('Stationery');
    expect(await prisma.priceHistory.count()).toBe(2);
    expect(await prisma.valueLedgerEntry.count()).toBe(2);

    const overview = (await client.get('/api/insights/overview')).body.data;
    expect(overview.currencies[0].totalValue).toBe('195.00');
  });

  it('rejects files without the required columns', async () => {
    const client = await createSignedInUser('header@example.com');
    const res = await client.post('/api/data/import', { csv: 'foo,bar\n1,2', defaultCurrency: 'INR' });
    expect(res.status).toBe(422);
  });
});
