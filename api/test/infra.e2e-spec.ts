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

  it('unversioned paths do not exist', async () => {
    await request(app.getHttpServer()).get('/restaurants').expect(404);
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
});
