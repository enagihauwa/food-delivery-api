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
