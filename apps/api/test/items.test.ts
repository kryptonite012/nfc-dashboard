import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { createSignedInUser, resetDatabase, type Client } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function addItem(client: Client, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await client.post('/api/items', { currency: 'INR', ...body }, headers);
  if (res.status !== 201 && res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.data;
}

describe('item validation', () => {
  it.each([
    [{ name: '', price: '10', currency: 'INR' }, 'name'],
    [{ name: 'A', price: '-1', currency: 'INR' }, 'price'],
    [{ name: 'A', price: '1.234', currency: 'INR' }, 'price'],
    [{ name: 'A', price: '1.5', currency: 'JPY' }, 'price'],
    [{ name: 'A', price: '1e5', currency: 'INR' }, 'price'],
    [{ name: 'A', price: 'NaN', currency: 'INR' }, 'price'],
    [{ name: 'A', price: '10', currency: 'XYZ' }, 'currency'],
    [{ name: 'A', price: '10', currency: 'INR', quantity: 0 }, 'quantity'],
    [{ name: 'A', price: '10', currency: 'INR', quantity: 1.5 }, 'quantity'],
    [{ name: 'A'.repeat(121), price: '10', currency: 'INR' }, 'name'],
    [{ name: 'A', price: '10', currency: 'INR', isAdmin: true }, '_'],
  ])('rejects %j', async (body, field) => {
    const client = await createSignedInUser('validate@example.com');
    const res = await client.post('/api/items', body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty(field);
    expect(await prisma.item.count()).toBe(0);
  });

  it('stores exact minor units and normalises tags', async () => {
    const client = await createSignedInUser('exact@example.com');
    const item = await addItem(client, { name: 'Desk', price: '1,299.50', quantity: 3, tags: ['Office', 'office', ' Home '] });
    expect(item).toMatchObject({ price: '1299.50', priceMinor: '129950', lineTotal: '3898.50', tags: ['office', 'home'] });
    expect(new Date(item.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('item lifecycle', () => {
  it('creates, updates with optimistic locking, soft-deletes, restores and purges', async () => {
    const client = await createSignedInUser('life@example.com');
    const item = await addItem(client, { name: 'Chair', price: '2500' });

    const updated = await client.patch(`/api/items/${item.id}`, { price: '2750.25', version: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ price: '2750.25', version: 2 });

    const stale = await client.patch(`/api/items/${item.id}`, { name: 'Old', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const detail = await client.get(`/api/items/${item.id}`);
    expect(detail.body.data.priceHistory.map((entry: { price: string }) => entry.price)).toEqual(['2750.25', '2500.00']);

    expect((await client.delete(`/api/items/${item.id}`)).status).toBe(200);
    expect((await client.get('/api/items')).body.meta.total).toBe(0);
    expect((await client.get('/api/items?status=deleted')).body.meta.total).toBe(1);

    expect((await client.post(`/api/items/${item.id}/restore`)).status).toBe(200);
    expect((await client.get('/api/items')).body.meta.total).toBe(1);

    // Purging is only possible from the trash.
    expect((await client.delete(`/api/items/${item.id}/permanent`)).status).toBe(404);
    await client.delete(`/api/items/${item.id}`);
    expect((await client.delete(`/api/items/${item.id}/permanent`)).status).toBe(200);
    expect(await prisma.item.count()).toBe(0);
  });

  it('treats a repeated Idempotency-Key as the same request', async () => {
    const client = await createSignedInUser('idem@example.com');
    const headers = { 'Idempotency-Key': 'form-submit-0001' };
    const first = await client.post('/api/items', { name: 'Mug', price: '300', currency: 'INR' }, headers);
    const second = await client.post('/api/items', { name: 'Mug', price: '300', currency: 'INR' }, headers);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.item.count()).toBe(1);
  });
});

describe('access control', () => {
  it("never exposes or modifies another user's records", async () => {
    const owner = await createSignedInUser('owner@example.com');
    const intruder = await createSignedInUser('intruder@example.com');
    const item = await addItem(owner, { name: 'Private ring', price: '50000' });
    const category = (await owner.post('/api/categories', { name: 'Jewellery' })).body.data;

    expect((await intruder.get(`/api/items/${item.id}`)).status).toBe(404);
    expect((await intruder.patch(`/api/items/${item.id}`, { name: 'Mine', version: 1 })).status).toBe(404);
    expect((await intruder.delete(`/api/items/${item.id}`)).status).toBe(404);
    expect((await intruder.post('/api/items/bulk', { action: 'delete', ids: [item.id] })).body.data.affected).toBe(0);
    expect((await intruder.get('/api/items')).body.meta.total).toBe(0);
    expect((await intruder.patch(`/api/categories/${category.id}`, { name: 'Hacked' })).status).toBe(404);

    const borrowCategory = await intruder.post('/api/items', { name: 'X', price: '1', currency: 'INR', categoryId: category.id });
    expect(borrowCategory.status).toBe(422);

    const untouched = await owner.get(`/api/items/${item.id}`);
    expect(untouched.body.data).toMatchObject({ name: 'Private ring', deletedAt: null });
  });

  it('treats malformed ids as not found', async () => {
    const client = await createSignedInUser('ids@example.com');
    expect((await client.get("/api/items/1' OR '1'='1")).status).toBe(404);
  });
});

describe('search, filters, sorting and pagination', () => {
  it('filters and sorts on the server', async () => {
    const client = await createSignedInUser('search@example.com');
    const category = (await client.post('/api/categories', { name: 'Kitchen' })).body.data;
    await addItem(client, { name: 'Kettle', price: '1999', categoryId: category.id, sku: 'KT-01' });
    await addItem(client, { name: 'Toaster', price: '2499', categoryId: category.id, tags: ['appliance'] });
    await addItem(client, { name: 'Novel', price: '399', description: 'A 100% gripping read' });
    await addItem(client, { name: 'Guitar strings', price: '12.50', currency: 'USD' });

    const byName = await client.get('/api/items?q=kett');
    expect(byName.body.data.map((item: { name: string }) => item.name)).toEqual(['Kettle']);
    expect((await client.get('/api/items?q=kt-01')).body.data[0].name).toBe('Kettle');
    expect((await client.get('/api/items?q=appliance')).body.data[0].name).toBe('Toaster');
    expect((await client.get('/api/items?q=100%25')).body.data[0].name).toBe('Novel');
    expect((await client.get('/api/items?q=%25')).body.meta.total).toBe(1);

    const kitchen = await client.get(`/api/items?categoryId=${category.id}&sort=price&order=asc`);
    expect(kitchen.body.data.map((item: { name: string }) => item.name)).toEqual(['Kettle', 'Toaster']);

    const priceRange = await client.get('/api/items?currency=INR&minPrice=400&maxPrice=2000');
    expect(priceRange.body.data.map((item: { name: string }) => item.name)).toEqual(['Kettle']);

    expect((await client.get('/api/items?minPrice=10')).status).toBe(422);

    const page = await client.get('/api/items?pageSize=2&page=2&sort=name&order=asc');
    expect(page.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
    expect(page.body.data.map((item: { name: string }) => item.name)).toEqual(['Novel', 'Toaster']);

    expect((await client.get('/api/items?pageSize=1000')).status).toBe(422);
  });
});

describe('dashboard figures', () => {
  it('computes exact per-currency totals without floating-point error', async () => {
    const client = await createSignedInUser('totals@example.com');
    await addItem(client, { name: 'A', price: '0.10' });
    await addItem(client, { name: 'B', price: '0.20' });
    await addItem(client, { name: 'C', price: '999999999999.99', quantity: 1000000 });
    await addItem(client, { name: 'D', price: '5', currency: 'USD', quantity: 3 });

    const overview = (await client.get('/api/insights/overview')).body.data;
    expect(overview.totalRecords).toBe(4);
    const inr = overview.currencies.find((entry: { currency: string }) => entry.currency === 'INR');
    expect(inr.totalValue).toBe('999999999999990000.30');
    expect(inr.highest.name).toBe('C');
    const usd = overview.currencies.find((entry: { currency: string }) => entry.currency === 'USD');
    expect(usd).toMatchObject({ totalValue: '15.00', averagePrice: '5.00', itemCount: 1 });
    expect(overview.currencies[0].currency).toBe('INR'); // the user's default currency first
  });

  it('reconstructs collection value over time from the ledger', async () => {
    const client = await createSignedInUser('ledger@example.com');
    const item = await addItem(client, { name: 'Camera', price: '1000', quantity: 2 });
    await client.patch(`/api/items/${item.id}`, { price: '900', version: 1 });
    await addItem(client, { name: 'Lens', price: '500' });
    await client.delete(`/api/items/${item.id}`);

    const analytics = (await client.get('/api/insights/analytics?currency=INR')).body.data;
    expect(analytics.collectionValue.at(-1).value).toBe('500.00');
    expect(analytics.valueChanges.at(-1)).toMatchObject({ additions: '2500.00', removals: '-1800.00', repricing: '-200.00' });
    expect(analytics.itemsAdded.at(-1).count).toBe(2);
    expect(analytics.priceChanges).toHaveLength(0); // the repriced item is now deleted
  });
});
