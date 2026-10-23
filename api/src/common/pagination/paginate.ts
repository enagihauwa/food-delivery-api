import { AppException } from '../errors/app-exception.js';
import {
  decodeCursor,
  encodeCursor,
  fromSortValue,
  toSortValue,
  type Direction,
  type Order,
  type SortType,
} from './cursor.js';
import { Paginated } from './paginated.js';

export interface SortSpec {
  column: string;
  type: SortType;
}
/** public sort name -> column. Anything not listed is rejected with 400. */
export type SortMap = Record<string, SortSpec>;

export interface PaginationLimits {
  defaultLimit: number;
  maxLimit: number;
}

export interface PageQuery {
  limit?: number;
  cursor?: string;
  offset?: number;
  sort?: string;
  order?: Order;
}

/** The slice of a Prisma delegate this helper needs. */
export interface ListDelegate<T> {
  findMany(args: Record<string, unknown>): Promise<T[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
}

export interface PaginateArgs<T> {
  delegate: ListDelegate<T>;
  where?: Record<string, unknown>;
  include?: Record<string, unknown>;
  sortMap: SortMap;
  defaultSort: string;
  defaultOrder?: Order;
  query: PageQuery;
  limits: PaginationLimits;
}

export function resolveSort(sortMap: SortMap, requested: string | undefined, fallback: string) {
  const name = requested ?? fallback;
  const spec = Object.hasOwn(sortMap, name) ? sortMap[name] : undefined;
  if (!spec) {
    const allowed = Object.keys(sortMap).join(', ');
    throw new AppException(400, 'INVALID_SORT_FIELD', `Cannot sort by '${name}'. Allowed: ${allowed}`, [
      { field: 'sort', message: `must be one of: ${allowed}` },
    ]);
  }
  return { name, spec };
}

export function resolveLimit(requested: number | undefined, limits: PaginationLimits): number {
  return Math.min(requested ?? limits.defaultLimit, limits.maxLimit);
}

/**
 * Keyset (cursor) pagination with an optional offset mode.
 *
 * Rows are always ordered by [sortColumn, id] so the ordering is total and
 * stable. The cursor stores the anchor row's sort value + id, so a deleted
 * anchor row does not break paging. One extra row is fetched to learn
 * `hasMore` without a second query.
 */
export async function paginate<T extends { id: string }>(args: PaginateArgs<T>): Promise<Paginated<T>> {
  const { delegate, include, sortMap, query, limits } = args;
  const { name: sort, spec } = resolveSort(sortMap, query.sort, args.defaultSort);
  const order: Order = query.order ?? args.defaultOrder ?? 'desc';
  const limit = resolveLimit(query.limit, limits);

  if (query.cursor !== undefined && query.offset !== undefined) {
    throw AppException.badRequest('Use either cursor or offset, not both', [
      { field: 'cursor', message: 'cannot be combined with offset' },
    ]);
  }

  const cursor = query.cursor !== undefined ? decodeCursor(query.cursor, { sort, order, type: spec.type }) : null;
  const baseWhere = args.where ?? {};
  const total = await delegate.count({ where: baseWhere });

  const direction: Direction = cursor?.d ?? 'next';
  const queryOrder: Order = direction === 'next' ? order : order === 'asc' ? 'desc' : 'asc';
  const op = queryOrder === 'asc' ? 'gt' : 'lt';

  let where: Record<string, unknown> = baseWhere;
  if (cursor) {
    const v = fromSortValue(cursor.v, spec.type);
    where = {
      AND: [baseWhere, { OR: [{ [spec.column]: { [op]: v } }, { [spec.column]: v, id: { [op]: cursor.i } }] }],
    };
  }

  const offset = cursor ? null : (query.offset ?? null);
  const fetched = await delegate.findMany({
    where,
    orderBy: [{ [spec.column]: queryOrder }, { id: queryOrder }],
    take: limit + 1,
    ...(offset ? { skip: offset } : {}),
    ...(include ? { include } : {}),
  });

  const hasExtra = fetched.length > limit;
  let rows = hasExtra ? fetched.slice(0, limit) : fetched;
  if (direction === 'prev') rows = rows.reverse();

  const anchor = (row: T, d: Direction) =>
    encodeCursor({ d, i: row.id, v: toSortValue((row as Record<string, unknown>)[spec.column]), s: sort, o: order });

  const first = rows[0];
  const last = rows[rows.length - 1];

  let hasMore: boolean;
  let nextCursor: string | null;
  let prevCursor: string | null;

  if (direction === 'next') {
    hasMore = hasExtra;
    nextCursor = hasMore && last ? anchor(last, 'next') : null;
    // Something precedes this page when we arrived via a cursor or an offset.
    prevCursor = first && (cursor || (offset ?? 0) > 0) ? anchor(first, 'prev') : null;
  } else {
    // We walked backwards, so the page we came from always lies after these rows.
    hasMore = rows.length > 0;
    nextCursor = last ? anchor(last, 'next') : null;
    prevCursor = hasExtra && first ? anchor(first, 'prev') : null;
  }

  return new Paginated(rows, { total, limit, hasMore, nextCursor, prevCursor, offset });
}
