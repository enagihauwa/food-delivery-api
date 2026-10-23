import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createClient } from '../src/api.js';

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('builds the URL from base, path and query and returns the envelope', async () => {
  let seen;
  const client = createClient('https://api.example.com/api/v1/', async (url, init) => {
    seen = { url, init };
    return json(200, { data: [{ id: '1' }], meta: { total: 1 } });
  });
  const body = await client.get('/restaurants', { limit: 12, cuisine: 'pizza', city: '' });
  assert.equal(seen.url, 'https://api.example.com/api/v1/restaurants?limit=12&cuisine=pizza');
  assert.equal(seen.init.headers.Accept, 'application/json');
  assert.deepEqual(body, { data: [{ id: '1' }], meta: { total: 1 } });
});

test('turns an error envelope into ApiError with code, status and Retry-After', async () => {
  const client = createClient('https://x/api/v1', async () =>
    json(429, { error: { code: 'RATE_LIMITED', message: 'Too many requests. Retry in 9 seconds.' } }, { 'Retry-After': '9' }),
  );
  await assert.rejects(client.get('/restaurants'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 429);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryAfter, 9);
    assert.match(error.message, /Too many requests/);
    return true;
  });
});

test('a non-JSON error body still yields a useful ApiError', async () => {
  const client = createClient('https://x', async () => new Response('<html>Bad gateway</html>', { status: 502 }));
  await assert.rejects(client.get('/a'), (error) => error.status === 502 && /502/.test(error.message));
});

test('a 200 without a data key is rejected rather than trusted', async () => {
  const client = createClient('https://x', async () => json(200, { hello: 'world' }));
  await assert.rejects(client.get('/a'), (error) => error instanceof ApiError && /Unexpected response/.test(error.message));
});

test('network failures become kind "network"; aborts propagate untouched', async () => {
  const offline = createClient('https://x', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(offline.get('/a'), (error) => error.kind === 'network');

  const aborted = createClient('https://x', async () => {
    throw new DOMException('aborted', 'AbortError');
  });
  await assert.rejects(aborted.get('/a'), (error) => error.name === 'AbortError');
});
