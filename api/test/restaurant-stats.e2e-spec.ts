import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { API, createTestApp } from './helpers.js';

const STATUSES = ['pending', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

describe('GET /restaurants/:id/stats', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  const get = (path: string) => request(server).get(`${API}${path}`);
  const stats = async (id: string) => (await get(`/restaurants/${id}/stats`).expect(200)).body.data;

  let busyId: string;
  let emptyId: string;
  const created: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    const counts = new Map<string, number>();
    const orders = (await get('/orders?limit=100').expect(200)).body.data as Array<{ restaurantId: string }>;
    for (const o of orders) counts.set(o.restaurantId, (counts.get(o.restaurantId) ?? 0) + 1);
    busyId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const restaurants = (await get('/restaurants?isOpen=true&limit=100').expect(200)).body.data as Array<{ id: string }>;
    for (const r of restaurants) {
      if ((await get(`/orders?restaurantId=${r.id}&limit=1`).expect(200)).body.meta.total === 0) {
        emptyId = r.id;
        break;
      }
    }
  });
  afterAll(async () => {
    for (const id of created) await request(server).delete(`${API}/orders/${id}`);
    await app.close();
  });

  it('returns the documented shape in the standard envelope', async () => {
    const res = await get(`/restaurants/${busyId}/stats`).expect(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(res.body.data).toEqual({
      restaurantId: busyId,
      currency: 'NGN',
      orders: { total: expect.any(Number), byStatus: expect.any(Object) },
      revenueKobo: expect.any(Number),
      averageOrderKobo: expect.any(Number),
    });
    expect(Object.keys(res.body.data.orders.byStatus).sort()).toEqual([...STATUSES].sort());
    expect(Number.isInteger(res.body.data.revenueKobo)).toBe(true);
    expect(Number.isInteger(res.body.data.averageOrderKobo)).toBe(true);
  });

  it('counts match what the order list reports, per status and in total', async () => {
    const s = await stats(busyId);
    const total = (await get(`/orders?restaurantId=${busyId}&limit=1`).expect(200)).body.meta.total;
    expect(s.orders.total).toBe(total);
    expect(Object.values(s.orders.byStatus).reduce((a: number, b) => a + (b as number), 0)).toBe(total);
    for (const status of STATUSES) {
      const n = (await get(`/orders?restaurantId=${busyId}&status=${status}&limit=1`).expect(200)).body.meta.total;
      expect(s.orders.byStatus[status]).toBe(n);
    }
  });

  it('revenue is the sum of delivered order totals; average is that sum over the delivered count', async () => {
    const s = await stats(busyId);
    let sum = 0;
    let count = 0;
    let path = `/orders?restaurantId=${busyId}&status=delivered&limit=100`;
    for (let guard = 0; guard < 10; guard++) {
      const { body } = await get(path).expect(200);
      for (const o of body.data) {
        sum += o.totalKobo;
        count += 1;
      }
      if (!body.meta.hasMore) break;
      path = `/orders?restaurantId=${busyId}&status=delivered&limit=100&cursor=${body.meta.nextCursor}`;
    }
    expect(count).toBeGreaterThan(0);
    expect(s.revenueKobo).toBe(sum);
    expect(s.averageOrderKobo).toBe(Math.round(sum / count));
  });

  it('a restaurant with no orders has zeros and a null average', async () => {
    expect(emptyId).toBeDefined();
    const s = await stats(emptyId);
    expect(s.orders.total).toBe(0);
    expect(Object.values(s.orders.byStatus)).toEqual([0, 0, 0, 0, 0]);
    expect(s.revenueKobo).toBe(0);
    expect(s.averageOrderKobo).toBeNull();
  });

  it('reflects a new order immediately, without counting it as revenue until delivered', async () => {
    const before = await stats(busyId);
    const customerId = (await get('/customers?limit=1').expect(200)).body.data[0].id;

    // Need an open restaurant to order from; use `emptyId` (open, no orders).
    const items = (await get(`/restaurants/${emptyId}/menu?available=true&limit=1`).expect(200)).body.data;
    expect(items.length).toBe(1);
    const order = await request(server)
      .post(`${API}/orders`)
      .send({ customerId, restaurantId: emptyId, deliveryAddress: '1 Stats Street', items: [{ menuItemId: items[0].id, quantity: 2 }] })
      .expect(201);
    created.push(order.body.data.id);

    const mid = await stats(emptyId);
    expect(mid.orders.total).toBe(1);
    expect(mid.orders.byStatus.pending).toBe(1);
    expect(mid.revenueKobo).toBe(0);
    expect(mid.averageOrderKobo).toBeNull();

    // Walk it to delivered: now it is revenue.
    for (const status of ['preparing', 'out_for_delivery', 'delivered']) {
      await request(server).patch(`${API}/orders/${order.body.data.id}`).send({ status }).expect(200);
    }
    const after = await stats(emptyId);
    expect(after.orders.byStatus).toMatchObject({ pending: 0, delivered: 1 });
    expect(after.revenueKobo).toBe(order.body.data.totalKobo);
    expect(after.averageOrderKobo).toBe(order.body.data.totalKobo);

    // Another restaurant's stats are untouched.
    expect(await stats(busyId)).toEqual(before);

    // Deleting the order removes it from the stats.
    await request(server).delete(`${API}/orders/${order.body.data.id}`).expect(204);
    expect((await stats(emptyId)).orders.total).toBe(0);
  });

  it('a cancelled order is counted but is not revenue', async () => {
    const customerId = (await get('/customers?limit=1').expect(200)).body.data[0].id;
    const items = (await get(`/restaurants/${emptyId}/menu?available=true&limit=1`).expect(200)).body.data;
    const order = await request(server)
      .post(`${API}/orders`)
      .send({ customerId, restaurantId: emptyId, deliveryAddress: '2 Stats Street', items: [{ menuItemId: items[0].id, quantity: 1 }] })
      .expect(201);
    created.push(order.body.data.id);
    await request(server).patch(`${API}/orders/${order.body.data.id}`).send({ status: 'cancelled' }).expect(200);
    const s = await stats(emptyId);
    expect(s.orders.byStatus.cancelled).toBe(1);
    expect(s.revenueKobo).toBe(0);
    await request(server).delete(`${API}/orders/${order.body.data.id}`).expect(204);
  });

  it('404s for an unknown or malformed restaurant id', async () => {
    const res = await get('/restaurants/00000000-0000-4000-8000-000000000000/stats').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Restaurant not found' } });
    await get('/restaurants/not-a-uuid/stats').expect(404);
  });

  it('takes no query parameters: any are rejected with 400', async () => {
    for (const qs of ['limit=5', 'status=delivered', 'from=2026-01-01']) {
      const res = await get(`/restaurants/${busyId}/stats?${qs}`).expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    }
  });

  it('is read-only', async () => {
    await request(server).post(`${API}/restaurants/${busyId}/stats`).send({}).expect(404);
    await request(server).delete(`${API}/restaurants/${busyId}/stats`).expect(404);
  });
});
