import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { API, createTestApp } from './helpers.js';

const META_KEYS = ['hasMore', 'limit', 'nextCursor', 'offset', 'prevCursor', 'total'];

describe('GET /restaurants/:id/orders', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  const get = (path: string) => request(server).get(`${API}${path}`);

  let busyRestaurantId: string; // a restaurant with several orders
  let emptyRestaurantId: string; // a restaurant with none

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    // Find the restaurant with the most orders by sampling the order list.
    const counts = new Map<string, number>();
    const orders = (await get('/orders?limit=100').expect(200)).body.data as Array<{ restaurantId: string }>;
    for (const o of orders) counts.set(o.restaurantId, (counts.get(o.restaurantId) ?? 0) + 1);
    busyRestaurantId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const restaurants = (await get('/restaurants?limit=100').expect(200)).body.data as Array<{ id: string }>;
    for (const r of restaurants) {
      const res = await get(`/restaurants/${r.id}/orders?limit=1`).expect(200);
      if (res.body.meta.total === 0) {
        emptyRestaurantId = r.id;
        break;
      }
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists only that restaurant’s orders in the standard envelope', async () => {
    const res = await get(`/restaurants/${busyRestaurantId}/orders?limit=100`).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(Object.keys(res.body.meta).sort()).toEqual(META_KEYS);
    for (const order of res.body.data) {
      expect(order.restaurantId).toBe(busyRestaurantId);
      expect(order).toEqual({
        id: expect.any(String),
        customerId: expect.any(String),
        restaurantId: busyRestaurantId,
        status: expect.any(String),
        deliveryAddress: expect.any(String),
        currency: 'NGN',
        totalKobo: expect.any(Number),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    }
  });

  it('agrees with the top-level /orders filter for the same restaurant', async () => {
    const nested = (await get(`/restaurants/${busyRestaurantId}/orders?limit=100`).expect(200)).body;
    const flat = (await get(`/orders?restaurantId=${busyRestaurantId}&limit=100`).expect(200)).body;
    expect(nested.meta.total).toBe(flat.meta.total);
    expect(nested.data.map((o: { id: string }) => o.id)).toEqual(flat.data.map((o: { id: string }) => o.id));
  });

  it('filters by status and by customerId', async () => {
    const all = (await get(`/restaurants/${busyRestaurantId}/orders?limit=100`).expect(200)).body.data;
    const sample = all[0];

    const byStatus = (await get(`/restaurants/${busyRestaurantId}/orders?status=${sample.status}&limit=100`).expect(200)).body;
    expect(byStatus.data.length).toBeGreaterThan(0);
    expect(byStatus.data.every((o: { status: string }) => o.status === sample.status)).toBe(true);

    const byCustomer = (await get(`/restaurants/${busyRestaurantId}/orders?customerId=${sample.customerId}&limit=100`).expect(200)).body;
    expect(byCustomer.data.length).toBeGreaterThan(0);
    expect(byCustomer.data.every((o: { customerId: string }) => o.customerId === sample.customerId)).toBe(true);

    const both = (await get(`/restaurants/${busyRestaurantId}/orders?status=${sample.status}&customerId=${sample.customerId}&limit=100`).expect(200)).body;
    expect(both.meta.total).toBeLessThanOrEqual(Math.min(byStatus.meta.total, byCustomer.meta.total));
  });

  it('sorts by total', async () => {
    const { data } = (await get(`/restaurants/${busyRestaurantId}/orders?sort=total&order=asc&limit=100`).expect(200)).body;
    const totals = data.map((o: { totalKobo: number }) => o.totalKobo);
    expect(totals).toEqual([...totals].sort((a: number, b: number) => a - b));
  });

  it('pages by cursor with no gaps or duplicates, and clamps limit=5000', async () => {
    expect((await get(`/restaurants/${busyRestaurantId}/orders?limit=5000`).expect(200)).body.meta.limit).toBe(100);

    const seen: string[] = [];
    let path = `/restaurants/${busyRestaurantId}/orders?limit=1&sort=total&order=desc`;
    let total = 0;
    for (let guard = 0; guard < 50; guard++) {
      const { body } = await get(path).expect(200);
      total = body.meta.total;
      seen.push(...body.data.map((o: { id: string }) => o.id));
      if (!body.meta.hasMore) break;
      path = `/restaurants/${busyRestaurantId}/orders?limit=1&sort=total&order=desc&cursor=${body.meta.nextCursor}`;
    }
    expect(total).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(total);
  });

  it('returns an empty page, not an error, for a restaurant with no orders', async () => {
    expect(emptyRestaurantId).toBeDefined();
    const res = await get(`/restaurants/${emptyRestaurantId}/orders`).expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toMatchObject({ total: 0, hasMore: false, nextCursor: null, prevCursor: null });
  });

  it('404s for an unknown or malformed restaurant id', async () => {
    const res = await get('/restaurants/00000000-0000-4000-8000-000000000000/orders').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Restaurant not found' } });
    await get('/restaurants/not-a-uuid/orders').expect(404);
  });

  it.each([
    ['status=teleported', 'BAD_REQUEST'],
    ['customerId=abc', 'BAD_REQUEST'],
    ['sort=banana', 'INVALID_SORT_FIELD'],
    ['offset=-1', 'BAD_REQUEST'],
    ['limit=0', 'BAD_REQUEST'],
    ['cursor=garbage', 'INVALID_CURSOR'],
    ['minTotal=5', 'BAD_REQUEST'], // not a filter on this endpoint; unknown params are rejected
  ])('bad input ?%s is a 400 %s', async (qs, code) => {
    const res = await get(`/restaurants/${busyRestaurantId}/orders?${qs}`).expect(400);
    expect(res.body.error.code).toBe(code);
  });

  it('is read-only', async () => {
    await request(server).post(`${API}/restaurants/${busyRestaurantId}/orders`).send({}).expect(404);
  });
});
