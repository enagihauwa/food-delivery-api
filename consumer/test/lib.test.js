import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQuery, describeError, describeRange, formatNaira, parseSort, titleCase } from '../src/lib.js';

test('formatNaira converts kobo to naira with grouping and two decimals', () => {
  assert.match(formatNaira(350000), /^₦3,500\.00$/);
  assert.match(formatNaira(19045000), /^₦190,450\.00$/);
  assert.match(formatNaira(5), /^₦0\.05$/);
  assert.match(formatNaira(0), /^₦0\.00$/);
});

test('buildQuery skips empty values and encodes the rest', () => {
  assert.equal(buildQuery({}), '');
  assert.equal(buildQuery({ a: '', b: null, c: undefined, d: false }), '');
  assert.equal(buildQuery({ limit: 12, q: 'mama put', isOpen: 'true' }), '?limit=12&q=mama+put&isOpen=true');
  assert.equal(buildQuery({ cursor: 'a+b/c=' }), '?cursor=a%2Bb%2Fc%3D');
  assert.equal(buildQuery({ minRating: 0 }), '?minRating=0'); // zero is a real value
});

test('describeError explains network, rate-limit, server and client errors', () => {
  assert.equal(describeError({ kind: 'network' }).title, 'Cannot reach the server');
  assert.equal(describeError({ kind: 'network' }).retryable, true);

  const limited = describeError({ kind: 'http', status: 429, retryAfter: 37 });
  assert.match(limited.message, /Try again in 37 seconds/);
  assert.match(describeError({ kind: 'http', status: 429, retryAfter: 1 }).message, /1 second\./);
  assert.match(describeError({ kind: 'http', status: 429, retryAfter: null }).message, /shortly/);

  assert.equal(describeError({ kind: 'http', status: 503 }).title, 'The server had a problem');
  const client = describeError({ kind: 'http', status: 400, message: 'offset must be 0 or greater' });
  assert.equal(client.retryable, false);
  assert.equal(client.message, 'offset must be 0 or greater');
});

test('describeRange', () => {
  assert.equal(describeRange({ pageIndex: 0, pageSize: 12, count: 12, total: 300 }), 'Showing 1–12 of 300');
  assert.equal(describeRange({ pageIndex: 2, pageSize: 12, count: 12, total: 300 }), 'Showing 25–36 of 300');
  assert.equal(describeRange({ pageIndex: 24, pageSize: 12, count: 5, total: 293 }), 'Showing 289–293 of 293');
  assert.equal(describeRange({ pageIndex: 0, pageSize: 12, count: 0, total: 0 }), 'No results');
});

test('parseSort and titleCase', () => {
  assert.deepEqual(parseSort('rating:desc'), { sort: 'rating', order: 'desc' });
  assert.equal(titleCase('out_for_delivery'), 'Out for delivery');
  assert.equal(titleCase('jollof'), 'Jollof');
});
