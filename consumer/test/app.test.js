import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { ApiError } from '../src/api.js';
import { mountApp } from '../src/app.js';

let dom;
let root;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><main id="app"></main>');
  root = dom.window.document.getElementById('app');
});

const restaurant = (n, overrides = {}) => ({
  id: `r-${n}`,
  name: `Place ${n}`,
  cuisine: 'jollof',
  city: 'Lagos',
  address: '1 Road',
  phone: null,
  rating: 4.5,
  isOpen: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const page = (items, meta = {}) => ({
  data: items,
  meta: { total: items.length, limit: 12, hasMore: false, nextCursor: null, prevCursor: null, offset: null, ...meta },
});

/** A scripted fake of client.get that records every call. */
function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    async get(path, params, options) {
      calls.push({ path, params: { ...params }, signal: options?.signal });
      return handler(path, params, calls.length, options);
    },
  };
}

const $ = (selector) => root.querySelector(selector);
const $$ = (selector) => [...root.querySelectorAll(selector)];
const change = (el, value) => {
  if (el.type === 'checkbox') el.checked = value;
  else el.value = value;
  el.dispatchEvent(new dom.window.Event(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', { bubbles: true }));
};
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('shows a loading state, then the restaurants and a range', async () => {
  const client = fakeClient(() => page([restaurant(1), restaurant(2)], { total: 300, hasMore: true, nextCursor: 'NEXT' }));
  const app = mountApp({ root, client, debounceMs: 0 });
  assert.match($('.status').textContent, /Loading/);
  assert.equal($('.results').getAttribute('aria-busy'), 'true');

  await app.idle();
  assert.equal($$('.card').length, 2);
  assert.match($('.card h2').textContent, /Place 1/);
  assert.match($('.status').textContent, /300 restaurants found/);
  assert.equal($('.range').textContent, 'Showing 1–2 of 300');
  assert.equal($('.results').getAttribute('aria-busy'), 'false');

  assert.equal(client.calls[0].path, '/restaurants');
  assert.deepEqual(client.calls[0].params, {
    limit: 12, cursor: null, sort: 'rating', order: 'desc', q: '', cuisine: '', city: '', minRating: '', isOpen: '',
  });
});

test('next and previous use the cursors from meta and keep the range right', async () => {
  const client = fakeClient((path, params) => {
    if (params.cursor === 'C2') return page([restaurant(13)], { total: 25, hasMore: true, nextCursor: 'C3', prevCursor: 'P2' });
    if (params.cursor === 'C3') return page([restaurant(25)], { total: 25, hasMore: false, prevCursor: 'P3' });
    if (params.cursor === 'P2') return page([restaurant(1)], { total: 25, hasMore: true, nextCursor: 'C2' });
    return page([restaurant(1)], { total: 25, hasMore: true, nextCursor: 'C2' });
  });
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();
  assert.equal($('button[name=prev]').disabled, true);
  assert.equal($('button[name=next]').disabled, false);

  click($('button[name=next]'));
  await app.idle();
  assert.equal(client.calls.at(-1).params.cursor, 'C2');
  assert.equal($('.range').textContent, 'Showing 13–13 of 25');
  assert.equal($('button[name=prev]').disabled, false);

  click($('button[name=next]'));
  await app.idle();
  assert.equal(client.calls.at(-1).params.cursor, 'C3');
  assert.equal($('.range').textContent, 'Showing 25–25 of 25');
  assert.equal($('button[name=next]').disabled, true, 'no next page on the last page');

  click($('button[name=prev]'));
  await app.idle();
  assert.equal(client.calls.at(-1).params.cursor, 'P3');
});

test('changing a filter sends it to the API and starts again from page one', async () => {
  const client = fakeClient((path, params) => page([restaurant(params.cursor ? 13 : 1)], { total: 40, hasMore: true, nextCursor: 'C2' }));
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();
  click($('button[name=next]'));
  await app.idle();
  assert.equal(client.calls.at(-1).params.cursor, 'C2');

  change($('select[name=cuisine]'), 'pizza');
  await app.idle();
  const call = client.calls.at(-1);
  assert.equal(call.params.cuisine, 'pizza');
  assert.equal(call.params.cursor, null, 'cursor reset when filters change');
  assert.equal($('.range').textContent, 'Showing 1–1 of 40');

  change($('select[name=city]'), 'Abuja');
  change($('select[name=minRating]'), '4');
  change($('input[name=isOpen]'), true);
  change($('select[name=sort]'), 'name:asc');
  await app.idle();
  assert.deepEqual(
    { city: client.calls.at(-1).params.city, minRating: client.calls.at(-1).params.minRating, isOpen: client.calls.at(-1).params.isOpen, sort: client.calls.at(-1).params.sort, order: client.calls.at(-1).params.order },
    { city: 'Abuja', minRating: '4', isOpen: 'true', sort: 'name', order: 'asc' },
  );
});

test('typing in search is debounced into a single request', async () => {
  const client = fakeClient(() => page([restaurant(1)]));
  const app = mountApp({ root, client, debounceMs: 20 });
  await app.idle();
  const before = client.calls.length;
  const input = $('input[name=q]');
  for (const text of ['m', 'ma', 'mam', 'mama']) change(input, text);
  await new Promise((r) => setTimeout(r, 60));
  await app.idle();
  assert.equal(client.calls.length, before + 1);
  assert.equal(client.calls.at(-1).params.q, 'mama');
});

test('empty state is shown when nothing matches, and Clear filters recovers', async () => {
  const client = fakeClient((path, params) => (params.cuisine === 'sushi' ? page([], { total: 0 }) : page([restaurant(1)])));
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();

  change($('select[name=cuisine]'), 'sushi');
  await app.idle();
  assert.ok($('[data-state=empty]'), 'empty state rendered');
  assert.match($('[data-state=empty]').textContent, /No restaurants match your filters/);
  assert.equal($$('.card').length, 0);
  assert.equal($('button[name=next]').disabled, true);

  click($('[data-state=empty] button'));
  await app.idle();
  assert.equal($('select[name=cuisine]').value, '');
  assert.equal($$('.card').length, 1);
});

test('network error shows an error state with Try again, which recovers', async () => {
  let fail = true;
  const client = fakeClient(() => {
    if (fail) throw new ApiError({ kind: 'network', message: 'down' });
    return page([restaurant(1)]);
  });
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();
  const error = $('[data-state=error]');
  assert.ok(error);
  assert.equal(error.getAttribute('role'), 'alert');
  assert.match(error.textContent, /Cannot reach the server/);
  assert.equal($('.pager').hidden, true);

  fail = false;
  click($('button[name=retry]'));
  await app.idle();
  assert.equal($$('.card').length, 1);
  assert.equal($('[data-state=error]'), null);
  assert.equal($('.pager').hidden, false);
});

test('a 429 explains the rate limit using Retry-After', async () => {
  const client = fakeClient(() => {
    throw new ApiError({ kind: 'http', status: 429, code: 'RATE_LIMITED', message: 'Too many requests', retryAfter: 42 });
  });
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();
  assert.match($('[data-state=error]').textContent, /Too many requests/);
  assert.match($('[data-state=error]').textContent, /Try again in 42 seconds/);
});

test('a 400 from the API is shown without a pointless retry button', async () => {
  const client = fakeClient(() => {
    throw new ApiError({ kind: 'http', status: 400, code: 'BAD_REQUEST', message: 'minRating must be between 0 and 5' });
  });
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();
  assert.match($('[data-state=error]').textContent, /minRating must be between 0 and 5/);
  assert.equal($('button[name=retry]'), null);
});

test('a slow stale response never overwrites a newer one', async () => {
  const resolvers = [];
  const client = {
    calls: [],
    get(path, params, { signal }) {
      this.calls.push(params);
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new dom.window.DOMException('aborted', 'AbortError')));
        resolvers.push((value) => resolve(value));
      });
    },
  };
  mountApp({ root, client, debounceMs: 0 });
  change($('select[name=cuisine]'), 'pizza'); // second request supersedes the first
  await tick();
  assert.equal(client.calls.length, 2);
  resolvers[0](page([restaurant(1, { name: 'STALE' })])); // first one settles late (already aborted)
  resolvers[1](page([restaurant(2, { name: 'FRESH' })]));
  await tick();
  assert.deepEqual($$('.card h2').map((n) => n.textContent), ['FRESH']);
});

test('API data is rendered as text, never as HTML', async () => {
  const evil = '<img src=x onerror="window.pwned=1">';
  const client = fakeClient(() => page([restaurant(1, { name: evil, city: '<b>Lagos</b>' })]));
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();
  assert.equal($('.card h2').textContent, evil);
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('b'), null);
  assert.equal(dom.window.pwned, undefined);
});

test('clicking a restaurant loads its menu with naira prices, and paginates the menu', async () => {
  const items = (n, extra = {}) => ({
    id: `m-${n}`, restaurantId: 'r-1', name: `Dish ${n}`, description: `Dish ${n}. Tasty.`, category: 'main', priceKobo: 350000 + n, available: true, createdAt: '2026-01-01T00:00:00Z', ...extra,
  });
  const client = fakeClient((path, params) => {
    if (path === '/restaurants') return page([restaurant(1)]);
    assert.equal(path, '/restaurants/r-1/menu');
    if (params.cursor === 'M2') return page([items(9, { available: false })], { total: 9, limit: 8, hasMore: false, prevCursor: 'MP' });
    if (params.category === 'drink') return page([], { total: 0, limit: 8 });
    return page([items(1), items(2)], { total: 9, limit: 8, hasMore: true, nextCursor: 'M2' });
  });
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();

  click($('.card-button'));
  await tick();
  const panel = $('.menu-panel');
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /Place 1/);
  assert.match($('[data-state=menu-list]').textContent, /₦3,500\.01/);
  assert.equal(client.calls.at(-1).params.sort, 'price');
  assert.equal(client.calls.at(-1).params.order, 'asc');
  assert.equal($('button[name=menu-prev]').disabled, true);

  click($('button[name=menu-next]'));
  await tick();
  assert.equal(client.calls.at(-1).params.cursor, 'M2');
  assert.match($('[data-state=menu-list]').textContent, /Unavailable/);
  assert.equal($('button[name=menu-next]').disabled, true);

  const category = $('select[name=category]');
  category.value = 'drink';
  category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(client.calls.at(-1).params.cursor, null);
  assert.ok($('[data-state=menu-empty]'));

  click($('.close'));
  assert.equal($('.menu-panel').hidden, true);
});

test('a failing menu request shows its own error with retry', async () => {
  let fail = true;
  const client = fakeClient((path) => {
    if (path === '/restaurants') return page([restaurant(1)]);
    if (fail) throw new ApiError({ kind: 'network', message: 'down' });
    return page([], { total: 0 });
  });
  const app = mountApp({ root, client, debounceMs: 0 });
  await app.idle();
  click($('.card-button'));
  await tick();
  assert.match($('[data-state=menu-error]').textContent, /Cannot reach the server/);
  fail = false;
  click($('button[name=menu-retry]'));
  await tick();
  assert.ok($('[data-state=menu-empty]'));
});
