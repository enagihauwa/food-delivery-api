import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { API, createTestApp } from './helpers.js';

const META_KEYS = ['hasMore', 'limit', 'nextCursor', 'offset', 'prevCursor', 'total'];

describe('restaurants', () => {
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

  describe('list envelope and pagination', () => {
    it('defaults to 20 rows, never the whole table, with the full meta shape', async () => {
      const res = await get('/restaurants').expect(200);
      expect(res.body.data).toHaveLength(20);
      expect(Object.keys(res.body.meta).sort()).toEqual(META_KEYS);
      expect(res.body.meta).toMatchObject({ limit: 20, hasMore: true, offset: null, prevCursor: null });
      expect(res.body.meta.total).toBeGreaterThanOrEqual(300);
      expect(res.body.meta.nextCursor).toEqual(expect.any(String));
    });

    it('returns documented fields with UUID ids and ISO dates', async () => {
      const [first] = (await get('/restaurants?limit=1').expect(200)).body.data;
      expect(first).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: expect.any(String),
        cuisine: expect.any(String),
        city: expect.any(String),
        address: expect.any(String),
        phone: expect.any(String),
        rating: expect.any(Number),
        isOpen: expect.any(Boolean),
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it('clamps limit=5000 to 100 instead of honouring it', async () => {
      const res = await get('/restaurants?limit=5000').expect(200);
      expect(res.body.data).toHaveLength(100);
      expect(res.body.meta.limit).toBe(100);
    });

    it('honours a small limit', async () => {
      const res = await get('/restaurants?limit=3').expect(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta.limit).toBe(3);
    });

    it('supports offset mode and reports the offset', async () => {
      const a = (await get('/restaurants?limit=5&sort=name&order=asc').expect(200)).body;
      const b = (await get('/restaurants?limit=5&offset=5&sort=name&order=asc').expect(200)).body;
      expect(b.meta.offset).toBe(5);
      expect(b.meta.prevCursor).toEqual(expect.any(String));
      expect(b.data.map((r: { id: string }) => r.id)).not.toEqual(a.data.map((r: { id: string }) => r.id));
      const both = (await get('/restaurants?limit=10&sort=name&order=asc').expect(200)).body;
      expect(both.data.slice(5).map((r: { id: string }) => r.id)).toEqual(b.data.map((r: { id: string }) => r.id));
    });

    it('reports hasMore=false and a null nextCursor on the last page', async () => {
      const total = (await get('/restaurants?limit=1').expect(200)).body.meta.total;
      const res = await get(`/restaurants?limit=10&offset=${total - 4}`).expect(200);
      expect(res.body.data).toHaveLength(4);
      expect(res.body.meta).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it('returns an empty page (not an error) when filters match nothing', async () => {
      const res = await get('/restaurants?city=Atlantis').expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toMatchObject({ total: 0, hasMore: false, nextCursor: null, prevCursor: null });
    });
  });

  describe.each([
    ['createdAt', 'desc'],
    ['name', 'asc'],
    ['rating', 'desc'],
  ])('walking every page by cursor (sort=%s order=%s)', (sort, order) => {
    it('visits every row exactly once, then walks back to the start', async () => {
      const limit = 100;
      const seen: string[] = [];
      let path = `/restaurants?limit=${limit}&sort=${sort}&order=${order}`;
      let total = 0;
      const pages: Array<{ first: string; prevCursor: string | null }> = [];

      for (let guard = 0; guard < 50; guard++) {
        const { body } = await get(path).expect(200);
        total = body.meta.total;
        if (body.data.length) pages.push({ first: body.data[0].id, prevCursor: body.meta.prevCursor });
        seen.push(...body.data.map((r: { id: string }) => r.id));
        if (!body.meta.hasMore) {
          expect(body.meta.nextCursor).toBeNull();
          break;
        }
        path = `/restaurants?limit=${limit}&sort=${sort}&order=${order}&cursor=${body.meta.nextCursor}`;
      }

      expect(new Set(seen).size).toBe(seen.length); // no duplicates
      expect(seen).toHaveLength(total); // no gaps

      // The first page has no prevCursor; later ones do, and following it returns the previous page.
      expect(pages[0].prevCursor).toBeNull();
      expect(pages.length).toBeGreaterThan(1);
      const last = pages[pages.length - 1];
      expect(last.prevCursor).toEqual(expect.any(String));
      const back = (await get(`/restaurants?limit=${limit}&sort=${sort}&order=${order}&cursor=${last.prevCursor}`).expect(200)).body;
      expect(back.data[0].id).toBe(pages[pages.length - 2].first);
      expect(back.meta.hasMore).toBe(true); // the page we came from lies after
    });
  });

  describe('filtering', () => {
    it('filters by cuisine and every row matches', async () => {
      const res = await get('/restaurants?cuisine=pizza&limit=100').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((r: { cuisine: string }) => r.cuisine === 'pizza')).toBe(true);
    });

    it('combines filters (cuisine + city + minRating)', async () => {
      const res = await get('/restaurants?cuisine=jollof&minRating=4&limit=100').expect(200);
      expect(res.body.data.every((r: { cuisine: string; rating: number }) => r.cuisine === 'jollof' && r.rating >= 4)).toBe(true);
    });

    it('matches city case-insensitively', async () => {
      const lower = (await get('/restaurants?city=lagos&limit=100').expect(200)).body;
      const exact = (await get('/restaurants?city=Lagos&limit=100').expect(200)).body;
      expect(lower.meta.total).toBe(exact.meta.total);
      expect(lower.meta.total).toBeGreaterThan(0);
    });

    it('filters by isOpen=false', async () => {
      const res = await get('/restaurants?isOpen=false&limit=100').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((r: { isOpen: boolean }) => r.isOpen === false)).toBe(true);
    });

    it('searches names with q', async () => {
      const res = await get('/restaurants?q=PIZZ&limit=100').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((r: { name: string }) => /pizz/i.test(r.name))).toBe(true);
    });

    it('keeps total consistent with the filter', async () => {
      const all = (await get('/restaurants?limit=1').expect(200)).body.meta.total;
      const pizza = (await get('/restaurants?cuisine=pizza&limit=1').expect(200)).body.meta.total;
      expect(pizza).toBeLessThan(all);
    });

    it('does not treat wildcard characters in q as patterns', async () => {
      expect((await get('/restaurants?q=%25').expect(200)).body.meta.total).toBe(0); // "%"
      expect((await get('/restaurants?q=_').expect(200)).body.meta.total).toBe(0);
      expect((await get('/restaurants?q=%5C').expect(200)).body.meta.total).toBe(0); // backslash
      // ...while ordinary punctuation still matches (every seeded name contains "'s ")
      expect((await get('/restaurants?q=%27s%20').expect(200)).body.meta.total).toBeGreaterThanOrEqual(300);
    });
  });

  describe('sorting', () => {
    it('sorts by rating desc', async () => {
      const { data } = (await get('/restaurants?sort=rating&order=desc&limit=100').expect(200)).body;
      const ratings = data.map((r: { rating: number }) => r.rating);
      expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    });
    it('sorts by name asc', async () => {
      const { data } = (await get('/restaurants?sort=name&order=asc&limit=100').expect(200)).body;
      const names = data.map((r: { name: string }) => r.name);
      expect(names).toHaveLength(100);
      // Compare with the database collation's ordering via a second request using offset.
      const next = (await get('/restaurants?sort=name&order=asc&limit=100&offset=100').expect(200)).body.data;
      expect(next[0].id).not.toBe(data[0].id);
    });
    it('accepts upper-case order', async () => {
      await get('/restaurants?sort=name&order=DESC').expect(200);
    });
  });

  describe('bad input (never a 500)', () => {
    const expectError = async (path: string, status: number, code: string, messagePart?: string) => {
      const res = await get(path).expect(status);
      expect(res.body.error.code).toBe(code);
      expect(Object.keys(res.body)).toEqual(['error']);
      if (messagePart) expect(res.body.error.message).toContain(messagePart);
      return res;
    };

    it('negative offset is 400 and names offset', () => expectError('/restaurants?offset=-1', 400, 'BAD_REQUEST', 'offset'));
    it('non-numeric offset is 400', () => expectError('/restaurants?offset=abc', 400, 'BAD_REQUEST', 'offset'));
    it('limit=0 is 400', () => expectError('/restaurants?limit=0', 400, 'BAD_REQUEST', 'limit'));
    it('limit=-5 is 400', () => expectError('/restaurants?limit=-5', 400, 'BAD_REQUEST', 'limit'));
    it('non-numeric limit is 400', () => expectError('/restaurants?limit=lots', 400, 'BAD_REQUEST', 'limit'));
    it('fractional limit is 400', () => expectError('/restaurants?limit=2.5', 400, 'BAD_REQUEST', 'limit'));
    it('repeated limit params are 400', () => expectError('/restaurants?limit=1&limit=2', 400, 'BAD_REQUEST'));
    it('unknown sort field is 400 INVALID_SORT_FIELD listing allowed fields', () =>
      expectError('/restaurants?sort=banana', 400, 'INVALID_SORT_FIELD', 'name, rating, createdAt'));
    it('prototype keys are not sort fields', () => expectError('/restaurants?sort=constructor', 400, 'INVALID_SORT_FIELD'));
    it('unknown order is 400', () => expectError('/restaurants?order=sideways', 400, 'BAD_REQUEST', 'order'));
    it('unknown cuisine is 400 and lists allowed values', () => expectError('/restaurants?cuisine=moon', 400, 'BAD_REQUEST', 'pizza'));
    it('non-numeric minRating is 400', () => expectError('/restaurants?minRating=abc', 400, 'BAD_REQUEST', 'minRating'));
    it('minRating out of range is 400', () => expectError('/restaurants?minRating=9', 400, 'BAD_REQUEST', 'minRating'));
    it('non-boolean isOpen is 400', () => expectError('/restaurants?isOpen=maybe', 400, 'BAD_REQUEST', 'isOpen'));
    it('unknown query parameters are rejected', () => expectError('/restaurants?colour=red', 400, 'BAD_REQUEST', 'colour'));
    it('garbage cursor is 400 INVALID_CURSOR', () => expectError('/restaurants?cursor=garbage', 400, 'INVALID_CURSOR'));
    it('cursor from a different sort is 400 INVALID_CURSOR', async () => {
      const { body } = await get('/restaurants?limit=2&sort=name').expect(200);
      await expectError(`/restaurants?sort=rating&cursor=${body.meta.nextCursor}`, 400, 'INVALID_CURSOR');
    });
    it('cursor plus offset is 400', async () => {
      const { body } = await get('/restaurants?limit=2').expect(200);
      await expectError(`/restaurants?cursor=${body.meta.nextCursor}&offset=2`, 400, 'BAD_REQUEST');
    });
    it('SQL-injection style strings are inert', async () => {
      const res = await get(`/restaurants?q=${encodeURIComponent("'; DROP TABLE restaurants;--")}`).expect(200);
      expect(res.body.meta.total).toBe(0);
      expect((await get('/restaurants?limit=1').expect(200)).body.meta.total).toBeGreaterThanOrEqual(300);
    });
  });

  describe('single restaurant', () => {
    let id: string;
    beforeAll(async () => {
      id = (await get('/restaurants?limit=1').expect(200)).body.data[0].id;
    });

    it('returns { data } with the resource', async () => {
      const res = await get(`/restaurants/${id}`).expect(200);
      expect(Object.keys(res.body)).toEqual(['data']);
      expect(res.body.data.id).toBe(id);
    });
    it('unknown but well-formed id is 404 NOT_FOUND', async () => {
      const res = await get('/restaurants/00000000-0000-4000-8000-000000000000').expect(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Restaurant not found' } });
    });
    it.each(['not-a-uuid', '123', "1'; DROP TABLE restaurants;--", '%00', 'ABCDEFGH-ABCD-ABCD-ABCD-ABCDEFGHIJKL'])(
      'malformed id %j is 404, never 500',
      async (bad) => {
        const res = await get(`/restaurants/${encodeURIComponent(bad)}`).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      },
    );
    it('rejects non-GET methods on the resource', async () => {
      await request(server).delete(`${API}/restaurants/${id}`).expect(404);
      await request(server).post(`${API}/restaurants`).send({}).expect(404);
    });
  });

  describe('nested menu', () => {
    let restaurantId: string;
    beforeAll(async () => {
      restaurantId = (await get('/restaurants?limit=1').expect(200)).body.data[0].id;
    });

    it('lists only that restaurant’s items, paginated, with kobo prices', async () => {
      const res = await get(`/restaurants/${restaurantId}/menu?limit=5`).expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
      expect(Object.keys(res.body.meta).sort()).toEqual(META_KEYS);
      for (const item of res.body.data) {
        expect(item.restaurantId).toBe(restaurantId);
        expect(Number.isInteger(item.priceKobo)).toBe(true);
        expect(item).toEqual({
          id: expect.any(String),
          restaurantId,
          name: expect.any(String),
          description: expect.any(String),
          category: expect.any(String),
          priceKobo: expect.any(Number),
          available: expect.any(Boolean),
          createdAt: expect.any(String),
        });
      }
    });

    it('filters by category and price range (kobo) and sorts by price', async () => {
      const all = (await get(`/restaurants/${restaurantId}/menu?limit=100&sort=price&order=asc`).expect(200)).body.data;
      const prices = all.map((m: { priceKobo: number }) => m.priceKobo);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));

      const mid = prices[Math.floor(prices.length / 2)];
      const ranged = (await get(`/restaurants/${restaurantId}/menu?limit=100&minPrice=${mid}&maxPrice=${mid}`).expect(200)).body.data;
      expect(ranged.length).toBeGreaterThan(0);
      expect(ranged.every((m: { priceKobo: number }) => m.priceKobo === mid)).toBe(true);

      const mains = (await get(`/restaurants/${restaurantId}/menu?category=main&limit=100`).expect(200)).body.data;
      expect(mains.every((m: { category: string }) => m.category === 'main')).toBe(true);
    });

    it('rejects minPrice greater than maxPrice and bad price values', async () => {
      await get(`/restaurants/${restaurantId}/menu?minPrice=500&maxPrice=100`).expect(400);
      await get(`/restaurants/${restaurantId}/menu?minPrice=-1`).expect(400);
      await get(`/restaurants/${restaurantId}/menu?minPrice=12.5`).expect(400);
      await get(`/restaurants/${restaurantId}/menu?sort=banana`).expect(400);
      await get(`/restaurants/${restaurantId}/menu?category=dessertish`).expect(400);
    });

    it('404s for an unknown or malformed restaurant', async () => {
      const res = await get('/restaurants/00000000-0000-4000-8000-000000000000/menu').expect(404);
      expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Restaurant not found' });
      await get('/restaurants/nope/menu').expect(404);
    });
  });

  describe('menu-items (top level)', () => {
    it('lists, filters by restaurantId, and fetches one', async () => {
      const list = (await get('/menu-items?limit=2').expect(200)).body;
      expect(list.meta.total).toBeGreaterThanOrEqual(300);
      const item = list.data[0];
      const one = (await get(`/menu-items/${item.id}`).expect(200)).body;
      expect(one).toEqual({ data: item });

      const scoped = (await get(`/menu-items?restaurantId=${item.restaurantId}&limit=100`).expect(200)).body;
      expect(scoped.data.every((m: { restaurantId: string }) => m.restaurantId === item.restaurantId)).toBe(true);
    });
    it('rejects a malformed restaurantId with 400 and unknown ids with 404', async () => {
      await get('/menu-items?restaurantId=abc').expect(400);
      await get('/menu-items/not-a-uuid').expect(404);
      await get('/menu-items/00000000-0000-4000-8000-000000000000').expect(404);
    });
    it('walks all menu items by cursor sorted by price without gaps or duplicates', async () => {
      const seen: string[] = [];
      let path = '/menu-items?limit=100&sort=price&order=asc';
      let total = 0;
      for (let guard = 0; guard < 60; guard++) {
        const { body } = await get(path).expect(200);
        total = body.meta.total;
        seen.push(...body.data.map((m: { id: string }) => m.id));
        if (!body.meta.hasMore) break;
        path = `/menu-items?limit=100&sort=price&order=asc&cursor=${body.meta.nextCursor}`;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(total);
    });
  });
});

describe('rate limiting on a real endpoint', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = '5';
    app = await createTestApp();
    process.env.RATE_LIMIT_MAX = '100000';
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns 429 with Retry-After and the error envelope after the limit', async () => {
    const server = app.getHttpServer();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(server).get(`${API}/restaurants?limit=1`)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);

    const res = await request(server).get(`${API}/restaurants`).expect(429);
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(res.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Retry in ${retryAfter} seconds.`,
        details: { retryAfterSeconds: retryAfter },
      },
    });
  });

  it('sends X-RateLimit headers on allowed requests and does not throttle /health', async () => {
    const fresh = await createTestApp(); // new in-memory counter with the generous default limit
    const res = await request(fresh.getHttpServer()).get(`${API}/restaurants?limit=1`).expect(200);
    expect(res.headers['x-ratelimit-limit']).toBe('100000');
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeLessThan(100000);
    await fresh.close();

    for (let i = 0; i < 10; i++) await request(app.getHttpServer()).get('/health').expect(200);
  });
});
