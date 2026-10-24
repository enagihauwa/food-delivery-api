import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './helpers.js';

describe('infrastructure', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /health is ok and outside the versioned prefix', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('unknown route returns a 404 in the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('paths outside /api/v1 are a 404 in the error envelope too, never an HTML page', async () => {
    for (const path of ['/restaurants', '/', '/health/ip', '/api/restaurants', '/favicon.ico']) {
      const res = await request(app.getHttpServer()).get(path).expect(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    }
    const post = await request(app.getHttpServer()).post('/nope').send({}).expect(404);
    expect(post.body.error.code).toBe('NOT_FOUND');
  });

  it('malformed JSON body is a 400 in the error envelope (never 500)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: expect.any(String) } });
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  describe('CORS', () => {
    const allowed = 'http://localhost:5173'; // CORS_ORIGINS in .env.example

    it('allows the configured consumer origin and exposes Retry-After', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/restaurants?limit=1').set('Origin', allowed).expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(allowed);
      expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('does not grant other origins', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/restaurants?limit=1').set('Origin', 'http://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers preflight for PATCH', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/orders/x')
        .set('Origin', allowed)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'content-type')
        .expect(204);
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    });
  });
});

describe('rate limit client identification behind proxies', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = '3';
    process.env.TRUST_PROXY_HOPS = '3'; // Render: client, Cloudflare, Render router
    app = await createTestApp();
    process.env.RATE_LIMIT_MAX = '100000';
    delete process.env.TRUST_PROXY_HOPS;
  });
  afterAll(async () => {
    await app.close();
  });

  const hit = (xff: string) => request(app.getHttpServer()).get('/api/v1/restaurants?limit=1').set('X-Forwarded-For', xff);

  it('limits per real client IP, not per proxy address', async () => {
    const chain = (client: string) => `${client}, 104.22.76.140, 10.31.55.151`;
    const a = [];
    for (let i = 0; i < 4; i++) a.push((await hit(chain('203.0.113.10'))).status);
    expect(a).toEqual([200, 200, 200, 429]);

    // A different client behind the very same proxies has its own allowance.
    expect((await hit(chain('203.0.113.11'))).status).toBe(200);
  });

  it('cannot be dodged by sending a forged X-Forwarded-For', async () => {
    const real = '198.51.100.7, 104.22.76.140, 10.31.55.151';
    for (let i = 0; i < 3; i++) await hit(real).expect(200);
    for (const forged of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      expect((await hit(`${forged}, ${real}`)).status).toBe(429); // prepended entries are ignored
    }
  });
});
