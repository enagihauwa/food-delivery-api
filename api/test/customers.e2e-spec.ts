import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { API, createTestApp } from './helpers.js';

describe('customers', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  const get = (path: string) => request(server).get(`${API}${path}`);

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists 20 by default with the envelope and documented fields', async () => {
    const res = await get('/customers').expect(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.meta).toMatchObject({ limit: 20, hasMore: true, offset: null });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(300);
    expect(res.body.data[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: expect.any(String),
      email: expect.stringMatching(/@example\.com$/),
      phone: expect.any(String),
      city: expect.any(String),
      createdAt: expect.any(String),
    });
  });

  it('clamps limit=5000 to 100', async () => {
    const res = await get('/customers?limit=5000').expect(200);
    expect(res.body.data).toHaveLength(100);
    expect(res.body.meta.limit).toBe(100);
  });

  it('filters by city (case-insensitive) and name search', async () => {
    const lagos = (await get('/customers?city=lagos&limit=100').expect(200)).body;
    expect(lagos.data.length).toBeGreaterThan(0);
    expect(lagos.data.every((c: { city: string }) => c.city === 'Lagos')).toBe(true);

    const name = lagos.data[0].name.split(' ')[0];
    const found = (await get(`/customers?q=${encodeURIComponent(name.toUpperCase())}&limit=100`).expect(200)).body;
    expect(found.data.length).toBeGreaterThan(0);
    expect(found.data.every((c: { name: string }) => c.name.toLowerCase().includes(name.toLowerCase()))).toBe(true);
  });

  it('sorts by name', async () => {
    const asc = (await get('/customers?sort=name&order=asc&limit=3').expect(200)).body.data;
    const desc = (await get('/customers?sort=name&order=desc&limit=3').expect(200)).body.data;
    expect(asc[0].id).not.toBe(desc[0].id);
  });

  it('walks every customer by cursor without gaps or duplicates', async () => {
    const seen: string[] = [];
    let path = '/customers?limit=100&sort=name&order=asc';
    let total = 0;
    for (let guard = 0; guard < 20; guard++) {
      const { body } = await get(path).expect(200);
      total = body.meta.total;
      seen.push(...body.data.map((c: { id: string }) => c.id));
      if (!body.meta.hasMore) break;
      path = `/customers?limit=100&sort=name&order=asc&cursor=${body.meta.nextCursor}`;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(total);
  });

  it.each([
    ['/customers?offset=-1', 'BAD_REQUEST'],
    ['/customers?sort=email', 'INVALID_SORT_FIELD'],
    ['/customers?limit=abc', 'BAD_REQUEST'],
    ['/customers?bogus=1', 'BAD_REQUEST'],
    ['/customers?cursor=nope', 'INVALID_CURSOR'],
  ])('bad input %s is a 400 %s', async (path, code) => {
    const res = await get(path).expect(400);
    expect(res.body.error.code).toBe(code);
  });

  it('GET /customers/:id returns one; unknown and malformed ids are 404', async () => {
    const id = (await get('/customers?limit=1').expect(200)).body.data[0].id;
    expect((await get(`/customers/${id}`).expect(200)).body.data.id).toBe(id);
    const res = await get('/customers/00000000-0000-4000-8000-000000000000').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Customer not found' } });
    await get('/customers/not-a-uuid').expect(404);
  });

  it('GET /customers/:id/orders lists only that customer’s orders, filterable by status', async () => {
    const withOrders = (await get('/orders?limit=1').expect(200)).body.data[0].customerId;
    const res = await get(`/customers/${withOrders}/orders?limit=100`).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((o: { customerId: string }) => o.customerId === withOrders)).toBe(true);
    expect(Object.keys(res.body.meta).sort()).toEqual(['hasMore', 'limit', 'nextCursor', 'offset', 'prevCursor', 'total']);

    const status = res.body.data[0].status;
    const filtered = (await get(`/customers/${withOrders}/orders?status=${status}&limit=100`).expect(200)).body;
    expect(filtered.data.every((o: { status: string }) => o.status === status)).toBe(true);

    await get(`/customers/${withOrders}/orders?status=teleported`).expect(400);
    await get('/customers/00000000-0000-4000-8000-000000000000/orders').expect(404);
    await get('/customers/nope/orders').expect(404);
  });
});
