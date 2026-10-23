export interface PageMeta {
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
  /** null in cursor mode, the numeric offset in offset mode */
  offset: number | null;
}

/** Marker returned by list handlers so the envelope interceptor emits `{ data, meta }`. */
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: PageMeta,
  ) {}
}
