import { decodeCursor, encodeCursor, fromSortValue, toSortValue } from './cursor.js';

const expected = { sort: 'createdAt', order: 'desc' as const, type: 'date' as const };
const valid = { d: 'next' as const, i: 'abc', v: '2026-01-01T00:00:00.000Z', s: 'createdAt', o: 'desc' as const };

describe('cursor', () => {
  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(valid), expected)).toEqual(valid);
  });
  it('is url-safe and opaque', () => {
    const c = encodeCursor(valid);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it.each([
    ['garbage', 'not-a-cursor!!'],
    ['not json', Buffer.from('hello').toString('base64url')],
    ['null', Buffer.from('null').toString('base64url')],
    ['bad direction', encodeCursor({ ...valid, d: 'sideways' as never })],
    ['sort mismatch', encodeCursor({ ...valid, s: 'name' })],
    ['order mismatch', encodeCursor({ ...valid, o: 'asc' })],
    ['bad date value', encodeCursor({ ...valid, v: 'nope' })],
    ['missing id', Buffer.from(JSON.stringify({ ...valid, i: undefined })).toString('base64url')],
  ])('rejects %s with INVALID_CURSOR', (_name, raw) => {
    expect(() => decodeCursor(raw, expected)).toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR', status: 400 }));
  });
  it('requires numeric value for number sorts', () => {
    const c = encodeCursor({ ...valid, s: 'priceKobo', v: '5' });
    expect(() => decodeCursor(c, { sort: 'priceKobo', order: 'desc', type: 'number' })).toThrow();
  });
  it('converts dates', () => {
    const d = new Date('2026-02-03T04:05:06.789Z');
    expect(fromSortValue(toSortValue(d), 'date')).toEqual(d);
  });
});
