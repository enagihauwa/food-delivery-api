import { paginate, resolveLimit, resolveSort, type ListDelegate, type SortMap } from './paginate.js';

const sortMap: SortMap = { name: { column: 'name', type: 'string' }, price: { column: 'priceKobo', type: 'number' } };
const limits = { defaultLimit: 20, maxLimit: 100 };
const fake = (rows: Array<{ id: string }> = []): ListDelegate<{ id: string }> => ({
  findMany: async () => rows,
  count: async () => rows.length,
});

describe('resolveLimit', () => {
  it('defaults to 20', () => expect(resolveLimit(undefined, limits)).toBe(20));
  it('clamps 5000 to the max', () => expect(resolveLimit(5000, limits)).toBe(100));
  it('keeps in-range values', () => expect(resolveLimit(7, limits)).toBe(7));
  it('respects configured limits', () => expect(resolveLimit(undefined, { defaultLimit: 5, maxLimit: 10 })).toBe(5));
});

describe('resolveSort', () => {
  it('uses the fallback when unspecified', () => expect(resolveSort(sortMap, undefined, 'name').spec.column).toBe('name'));
  it('maps aliases to columns', () => expect(resolveSort(sortMap, 'price', 'name').spec.column).toBe('priceKobo'));
  it('rejects unknown fields and lists the allowed ones', () => {
    expect(() => resolveSort(sortMap, 'banana', 'name')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SORT_FIELD', message: expect.stringContaining('name, price') }),
    );
  });
  it('does not treat inherited object keys as sort fields', () => {
    expect(() => resolveSort(sortMap, 'constructor', 'name')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SORT_FIELD' }),
    );
    expect(() => resolveSort(sortMap, '__proto__', 'name')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SORT_FIELD' }),
    );
  });
});

describe('paginate', () => {
  it('rejects cursor combined with offset', async () => {
    await expect(
      paginate({ delegate: fake(), sortMap, defaultSort: 'name', limits, query: { cursor: 'x', offset: 1 } }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects an invalid cursor', async () => {
    await expect(
      paginate({ delegate: fake(), sortMap, defaultSort: 'name', limits, query: { cursor: 'x' } }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
  it('queries limit+1 rows and reports hasMore from the extra row', async () => {
    const seen: Record<string, unknown>[] = [];
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id${i}`, name: `n${i}` }));
    const delegate: ListDelegate<(typeof rows)[number]> = {
      findMany: async (a) => (seen.push(a), rows),
      count: async () => 10,
    };
    const page = await paginate({ delegate, sortMap, defaultSort: 'name', limits, query: { limit: 2, order: 'asc' } });
    expect(seen[0]).toMatchObject({ take: 3, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    expect(page.items).toHaveLength(2);
    expect(page.meta).toMatchObject({ total: 10, limit: 2, hasMore: true, offset: null, prevCursor: null });
    expect(page.meta.nextCursor).toBeTruthy();
  });
});
