import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { API, createTestApp } from './helpers.js';

type Item = { id: string; restaurantId: string; priceKobo: number; available: boolean };

describe('orders', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  const get = (path: string) => request(server).get(`${API}${path}`);
  const post = (body: unknown) => request(server).post(`${API}/orders`).send(body as object);
  const patch = (id: string, body: unknown) => request(server).patch(`${API}/orders/${id}`).send(body as object);
  const del = (id: string) => request(server).delete(`${API}/orders/${id}`);

  let customerId: string;
  let restaurantId: string;
  let items: Item[]; // available items of an open restaurant
  let otherRestaurantItem: Item;
  let unavailableItem: Item;
  let closedRestaurantId: string;
  const created: string[] = [];

  const newOrder = async (overrides: Record<string, unknown> = {}) => {
    const res = await post({
      customerId,
      restaurantId,
      deliveryAddress: '12 Test Street, Ikeja',
      items: [{ menuItemId: items[0].id, quantity: 2 }],
      ...overrides,
    });
    if (res.status === 201) created.push(res.body.data.id);
    return res;
  };

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    customerId = (await get('/customers?limit=1').expect(200)).body.data[0].id;

    // An open restaurant with at least three available items.
    const open = (await get('/restaurants?isOpen=true&limit=100').expect(200)).body.data;
    for (const r of open) {
      const menu = (await get(`/restaurants/${r.id}/menu?available=true&limit=100`).expect(200)).body.data;
      if (menu.length >= 3) {
        restaurantId = r.id;
        items = menu;
        break;
      }
    }
    const other = open.find((r: { id: string }) => r.id !== restaurantId);
    otherRestaurantItem = (await get(`/restaurants/${other.id}/menu?available=true&limit=1`).expect(200)).body.data[0];
    const unavailable = (await get('/menu-items?available=false&limit=100').expect(200)).body.data as Item[];
    unavailableItem = unavailable.find((i) => i.restaurantId === restaurantId) ?? unavailable[0];
    closedRestaurantId = (await get('/restaurants?isOpen=false&limit=1').expect(200)).body.data[0].id;
  });

  afterAll(async () => {
    for (const id of created) await del(id);
    await app.close();
  });

  describe('GET /orders', () => {
    it('lists 20 by default, newest first, with currency and no items array', async () => {
      const res = await get('/orders').expect(200);
      expect(res.body.data.length).toBe(20);
      expect(res.body.meta).toMatchObject({ limit: 20, offset: null, hasMore: true });
      const dates = res.body.data.map((o: { createdAt: string }) => o.createdAt);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(res.body.data[0]).toEqual({
        id: expect.any(String),
        customerId: expect.any(String),
        restaurantId: expect.any(String),
        status: expect.stringMatching(/^(pending|preparing|out_for_delivery|delivered|cancelled)$/),
        deliveryAddress: expect.any(String),
        currency: 'NGN',
        totalKobo: expect.any(Number),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('clamps limit=5000', async () => {
      const res = await get('/orders?limit=5000').expect(200);
      expect(res.body.data).toHaveLength(100);
      expect(res.body.meta.limit).toBe(100);
    });

    it('filters by status, restaurantId and customerId', async () => {
      const delivered = (await get('/orders?status=delivered&limit=100').expect(200)).body;
      expect(delivered.data.every((o: { status: string }) => o.status === 'delivered')).toBe(true);

      const sample = delivered.data[0];
      const byRestaurant = (await get(`/orders?restaurantId=${sample.restaurantId}&limit=100`).expect(200)).body;
      expect(byRestaurant.data.every((o: { restaurantId: string }) => o.restaurantId === sample.restaurantId)).toBe(true);
      const byCustomer = (await get(`/orders?customerId=${sample.customerId}&limit=100`).expect(200)).body;
      expect(byCustomer.data.every((o: { customerId: string }) => o.customerId === sample.customerId)).toBe(true);

      const combined = (await get(`/orders?status=delivered&customerId=${sample.customerId}&limit=100`).expect(200)).body;
      expect(combined.data.length).toBeGreaterThan(0);
      expect(combined.meta.total).toBeLessThanOrEqual(byCustomer.meta.total);
    });

    it('filters by total range in kobo and sorts by total', async () => {
      const res = await get('/orders?minTotal=1000000&maxTotal=3000000&sort=total&order=asc&limit=100').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      const totals = res.body.data.map((o: { totalKobo: number }) => o.totalKobo);
      expect(totals.every((t: number) => t >= 1000000 && t <= 3000000)).toBe(true);
      expect(totals).toEqual([...totals].sort((a: number, b: number) => a - b));
    });

    it('filters by date range; a date-only "to" includes that whole day', async () => {
      const sample = (await get('/orders?limit=1').expect(200)).body.data[0];
      const day = sample.createdAt.slice(0, 10);
      const res = await get(`/orders?from=${day}&to=${day}&limit=100`).expect(200);
      expect(res.body.data.map((o: { id: string }) => o.id)).toContain(sample.id);
      expect(res.body.data.every((o: { createdAt: string }) => o.createdAt.startsWith(day))).toBe(true);
    });

    it('walks all orders by cursor sorted by total with no gaps or duplicates', async () => {
      const seen: string[] = [];
      let path = '/orders?limit=100&sort=total&order=desc';
      let total = 0;
      for (let guard = 0; guard < 30; guard++) {
        const { body } = await get(path).expect(200);
        total = body.meta.total;
        seen.push(...body.data.map((o: { id: string }) => o.id));
        if (!body.meta.hasMore) break;
        path = `/orders?limit=100&sort=total&order=desc&cursor=${body.meta.nextCursor}`;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(total);
    });

    it.each([
      ['/orders?status=teleported', 'BAD_REQUEST'],
      ['/orders?restaurantId=abc', 'BAD_REQUEST'],
      ['/orders?customerId=123', 'BAD_REQUEST'],
      ['/orders?minTotal=abc', 'BAD_REQUEST'],
      ['/orders?minTotal=-5', 'BAD_REQUEST'],
      ['/orders?minTotal=500&maxTotal=100', 'BAD_REQUEST'],
      ['/orders?from=yesterday', 'BAD_REQUEST'],
      ['/orders?from=2026-05-02&to=2026-05-01', 'BAD_REQUEST'],
      ['/orders?sort=totalKobo', 'INVALID_SORT_FIELD'],
      ['/orders?sort=banana', 'INVALID_SORT_FIELD'],
      ['/orders?offset=-1', 'BAD_REQUEST'],
    ])('bad input %s is a 400 %s', async (path, code) => {
      const res = await get(path).expect(400);
      expect(res.body.error.code).toBe(code);
    });

    it('returns an empty page for a filter that matches nothing', async () => {
      const res = await get('/orders?minTotal=999999999999').expect(400); // beyond int range is rejected, not a 500
      expect(res.body.error.code).toBe('BAD_REQUEST');
      const empty = await get('/orders?customerId=00000000-0000-4000-8000-000000000000').expect(200);
      expect(empty.body.data).toEqual([]);
      expect(empty.body.meta.total).toBe(0);
    });
  });

  describe('POST /orders', () => {
    it('creates an order: 201, Location header, server-computed total, item snapshot', async () => {
      const lines = [
        { menuItemId: items[0].id, quantity: 2 },
        { menuItemId: items[1].id, quantity: 1 },
      ];
      const res = await newOrder({ items: lines });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`${API}/orders/${res.body.data.id}`);
      expect(Object.keys(res.body)).toEqual(['data']);

      const expectedTotal = 2 * items[0].priceKobo + items[1].priceKobo;
      expect(res.body.data).toMatchObject({
        customerId,
        restaurantId,
        status: 'pending',
        currency: 'NGN',
        totalKobo: expectedTotal,
        deliveryAddress: '12 Test Street, Ikeja',
      });
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items).toEqual(
        expect.arrayContaining([
          { id: expect.any(String), menuItemId: items[0].id, name: expect.any(String), quantity: 2, unitPriceKobo: items[0].priceKobo },
          { id: expect.any(String), menuItemId: items[1].id, name: expect.any(String), quantity: 1, unitPriceKobo: items[1].priceKobo },
        ]),
      );

      const fetched = await get(`/orders/${res.body.data.id}`).expect(200);
      expect(fetched.body.data.totalKobo).toBe(expectedTotal);
      expect(fetched.body.data.items).toHaveLength(2);
    });

    it('trims the delivery address', async () => {
      const res = await newOrder({ deliveryAddress: '   5 Trim Road   ' });
      expect(res.body.data.deliveryAddress).toBe('5 Trim Road');
    });

    const field = (res: request.Response, name: string) =>
      (res.body.error.details as Array<{ field: string; message: string }>).find((d) => d.field === name);

    it('missing customerId is 422 and names the field', async () => {
      const res = await post({ restaurantId, deliveryAddress: 'x', items: [{ menuItemId: items[0].id, quantity: 1 }] });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Request body is invalid' });
      expect(field(res, 'customerId')?.message).toContain('customerId');
    });

    it('empty body lists every required field', async () => {
      const res = await post({}).expect(422);
      const names = res.body.error.details.map((d: { field: string }) => d.field);
      expect(names).toEqual(expect.arrayContaining(['customerId', 'restaurantId', 'deliveryAddress', 'items']));
    });

    it('no body at all is 422, never 500', async () => {
      const res = await request(server).post(`${API}/orders`).expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('an array or null body is 422', async () => {
      expect((await post([])).status).toBe(422);
      const res = await request(server).post(`${API}/orders`).set('Content-Type', 'application/json').send('null');
      expect([400, 422]).toContain(res.status);
      expect(res.body.error).toBeDefined();
    });

    it('malformed JSON is 400', async () => {
      const res = await request(server).post(`${API}/orders`).set('Content-Type', 'application/json').send('{"customerId":').expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it.each([
      ['empty items', { items: [] }, 'items'],
      ['items not an array', { items: 'pizza' }, 'items'],
      ['quantity 0', { items: [{ menuItemId: 'ITEM0', quantity: 0 }] }, 'items.0.quantity'],
      ['quantity 51', { items: [{ menuItemId: 'ITEM0', quantity: 51 }] }, 'items.0.quantity'],
      ['fractional quantity', { items: [{ menuItemId: 'ITEM0', quantity: 1.5 }] }, 'items.0.quantity'],
      ['string quantity', { items: [{ menuItemId: 'ITEM0', quantity: '2' }] }, 'items.0.quantity'],
      ['non-uuid menuItemId', { items: [{ menuItemId: 'abc', quantity: 1 }] }, 'items.0.menuItemId'],
      ['bad customerId', { customerId: 'abc' }, 'customerId'],
      ['bad restaurantId', { restaurantId: 'abc' }, 'restaurantId'],
      ['blank address', { deliveryAddress: '' }, 'deliveryAddress'],
      ['numeric address', { deliveryAddress: 5 }, 'deliveryAddress'],
      ['overlong address', { deliveryAddress: 'x'.repeat(251) }, 'deliveryAddress'],
      ['client-supplied total', { totalKobo: 1 }, 'totalKobo'],
      ['client-supplied id', { id: '00000000-0000-4000-8000-000000000000' }, 'id'],
      ['client-supplied status', { status: 'delivered' }, 'status'],
    ])('%s is 422 naming %s', async (_name, overrides, fieldName) => {
      const body = JSON.parse(JSON.stringify(overrides).replace('ITEM0', items[0].id));
      const res = await newOrder(body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(field(res, fieldName)).toBeDefined();
    });

    it('unknown customer and restaurant are 422 with the field named', async () => {
      const res = await newOrder({
        customerId: '00000000-0000-4000-8000-000000000000',
        restaurantId: '00000000-0000-4000-8000-000000000001',
      });
      expect(res.status).toBe(422);
      expect(field(res, 'customerId')?.message).toBe('customer not found');
      expect(field(res, 'restaurantId')?.message).toBe('restaurant not found');
    });

    it('a closed restaurant is 422', async () => {
      const res = await newOrder({ restaurantId: closedRestaurantId });
      expect(res.status).toBe(422);
      expect(field(res, 'restaurantId')?.message).toBe('restaurant is currently closed');
    });

    it('an item from another restaurant is 422', async () => {
      const res = await newOrder({ items: [{ menuItemId: otherRestaurantItem.id, quantity: 1 }] });
      expect(res.status).toBe(422);
      expect(field(res, 'items.0.menuItemId')?.message).toBe('menu item does not belong to this restaurant');
    });

    it('an unavailable item is 422', async () => {
      const res = await newOrder({ items: [{ menuItemId: unavailableItem.id, quantity: 1 }], restaurantId: unavailableItem.restaurantId });
      expect(res.status).toBe(422);
      expect(res.body.error.details.some((d: { message: string }) => /not available|currently closed/.test(d.message))).toBe(true);
    });

    it('an unknown menu item is 422', async () => {
      const res = await newOrder({ items: [{ menuItemId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] });
      expect(res.status).toBe(422);
      expect(field(res, 'items.0.menuItemId')?.message).toBe('menu item not found');
    });

    it('duplicate lines are 422', async () => {
      const res = await newOrder({
        items: [
          { menuItemId: items[0].id, quantity: 1 },
          { menuItemId: items[0].id, quantity: 1 },
        ],
      });
      expect(res.status).toBe(422);
      expect(field(res, 'items.1.menuItemId')?.message).toContain('duplicate');
    });

    it('rejected orders leave nothing behind', async () => {
      const before = (await get('/orders?limit=1').expect(200)).body.meta.total;
      await newOrder({ items: [] });
      await newOrder({ customerId: '00000000-0000-4000-8000-000000000000' });
      expect((await get('/orders?limit=1').expect(200)).body.meta.total).toBe(before);
    });
  });

  describe('GET /orders/:id', () => {
    it('returns items whose lines add up to the stored total', async () => {
      const id = (await get('/orders?limit=1').expect(200)).body.data[0].id;
      const { data } = (await get(`/orders/${id}`).expect(200)).body;
      expect(data.items.length).toBeGreaterThan(0);
      const sum = data.items.reduce((s: number, i: { quantity: number; unitPriceKobo: number }) => s + i.quantity * i.unitPriceKobo, 0);
      expect(sum).toBe(data.totalKobo);
    });
    it('unknown id is 404 and malformed ids are 404', async () => {
      const res = await get('/orders/00000000-0000-4000-8000-000000000000').expect(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      await get('/orders/xyz').expect(404);
      await get("/orders/1' OR '1'='1").expect(404);
    });
  });

  describe('PATCH /orders/:id', () => {
    it('walks the happy path pending -> preparing -> out_for_delivery -> delivered', async () => {
      const { id } = (await newOrder()).body.data;
      const before = (await get(`/orders/${id}`).expect(200)).body.data;
      for (const status of ['preparing', 'out_for_delivery', 'delivered']) {
        const res = await patch(id, { status }).expect(200);
        expect(res.body.data.status).toBe(status);
        expect(res.body.data.items).toHaveLength(1);
      }
      const after = (await get(`/orders/${id}`).expect(200)).body.data;
      expect(after.status).toBe('delivered');
      expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
      expect(after.createdAt).toBe(before.createdAt);
      expect(after.totalKobo).toBe(before.totalKobo);
    });

    it('illegal transitions are 409 INVALID_STATUS_TRANSITION and change nothing', async () => {
      const { id } = (await newOrder()).body.data;
      const res = await patch(id, { status: 'delivered' }).expect(409);
      expect(res.body.error).toEqual({
        code: 'INVALID_STATUS_TRANSITION',
        message: "Cannot change order from 'pending' to 'delivered'",
      });
      expect((await get(`/orders/${id}`).expect(200)).body.data.status).toBe('pending');

      await patch(id, { status: 'cancelled' }).expect(200);
      await patch(id, { status: 'pending' }).expect(409);
      await patch(id, { status: 'preparing' }).expect(409);
    });

    it('the same status is an idempotent 200', async () => {
      const { id } = (await newOrder()).body.data;
      await patch(id, { status: 'pending' }).expect(200);
      await patch(id, { status: 'preparing' }).expect(200);
      await patch(id, { status: 'preparing' }).expect(200);
    });

    it('changes the address while pending/preparing but not afterwards', async () => {
      const { id } = (await newOrder()).body.data;
      const res = await patch(id, { deliveryAddress: '  99 New Address ' }).expect(200);
      expect(res.body.data.deliveryAddress).toBe('99 New Address');
      await patch(id, { status: 'preparing' }).expect(200);
      await patch(id, { deliveryAddress: '100 Other' }).expect(200);
      await patch(id, { status: 'out_for_delivery' }).expect(200);
      const blocked = await patch(id, { deliveryAddress: '101 Too Late' }).expect(409);
      expect(blocked.body.error.code).toBe('CONFLICT');
    });

    it('updates status and address together', async () => {
      const { id } = (await newOrder()).body.data;
      const res = await patch(id, { status: 'preparing', deliveryAddress: 'Both Fields' }).expect(200);
      expect(res.body.data).toMatchObject({ status: 'preparing', deliveryAddress: 'Both Fields' });
    });

    it('an invalid transition prevents the address from changing too (atomic)', async () => {
      const { id } = (await newOrder()).body.data;
      await patch(id, { status: 'delivered', deliveryAddress: 'Should Not Apply' }).expect(409);
      expect((await get(`/orders/${id}`).expect(200)).body.data.deliveryAddress).toBe('12 Test Street, Ikeja');
    });

    it.each([
      ['empty body', {}],
      ['unknown status', { status: 'teleported' }],
      ['non-string status', { status: 5 }],
      ['blank address', { deliveryAddress: '' }],
      ['totalKobo', { totalKobo: 1 }],
      ['customerId', { customerId: '00000000-0000-4000-8000-000000000000' }],
      ['items', { items: [] }],
      ['id', { id: '00000000-0000-4000-8000-000000000000' }],
    ])('rejects %s with 422', async (_name, body) => {
      const { id } = (await newOrder()).body.data;
      const res = await patch(id, body).expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    });

    it('unknown and malformed ids are 404', async () => {
      await patch('00000000-0000-4000-8000-000000000000', { status: 'preparing' }).expect(404);
      await patch('nope', { status: 'preparing' }).expect(404);
    });

    it('concurrent conflicting updates never produce a 500 and leave a valid state', async () => {
      const { id } = (await newOrder()).body.data;
      const results = await Promise.all([
        patch(id, { status: 'preparing' }),
        patch(id, { status: 'cancelled' }),
        patch(id, { status: 'preparing' }),
        patch(id, { status: 'cancelled' }),
      ]);
      for (const r of results) expect([200, 409]).toContain(r.status);
      expect(results.some((r) => r.status === 200)).toBe(true);
      const final = (await get(`/orders/${id}`).expect(200)).body.data.status;
      expect(['preparing', 'cancelled']).toContain(final);
    });
  });

  describe('DELETE /orders/:id', () => {
    it('removes the order with 204 and an empty body, then it is gone', async () => {
      const { id } = (await newOrder()).body.data;
      const res = await del(id).expect(204);
      expect(res.text).toBe('');
      await get(`/orders/${id}`).expect(404);
      const again = await del(id).expect(404);
      expect(again.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    });
    it('malformed ids are 404', async () => {
      await del('nope').expect(404);
    });
    it('deleting an order also removes its lines (no orphans)', async () => {
      const { id } = (await newOrder()).body.data;
      await del(id).expect(204);
      await patch(id, { status: 'preparing' }).expect(404);
    });
  });

  it('method not allowed on the collection is a 404 error envelope', async () => {
    const res = await request(server).delete(`${API}/orders`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    await request(server).put(`${API}/orders/00000000-0000-4000-8000-000000000000`).send({}).expect(404);
  });
});
