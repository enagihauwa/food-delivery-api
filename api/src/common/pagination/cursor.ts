import { AppException } from '../errors/app-exception.js';

export type Order = 'asc' | 'desc';
export type Direction = 'next' | 'prev';
export type SortType = 'string' | 'number' | 'date';

export interface CursorPayload {
  /** direction to walk from the anchor row */
  d: Direction;
  /** anchor row id */
  i: string;
  /** anchor row sort value (dates as ISO strings) */
  v: string | number;
  /** sort field public name and order the cursor was issued for */
  s: string;
  o: Order;
}

const invalid = () => new AppException(400, 'INVALID_CURSOR', 'Cursor is malformed or does not match the current sort');

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, expected: { sort: string; order: Order; type: SortType }): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const p = parsed as Partial<CursorPayload> | null;
  const valueOk =
    expected.type === 'number'
      ? typeof p?.v === 'number'
      : typeof p?.v === 'string' && (expected.type !== 'date' || !Number.isNaN(Date.parse(p.v)));
  if (
    !p ||
    typeof p !== 'object' ||
    (p.d !== 'next' && p.d !== 'prev') ||
    typeof p.i !== 'string' ||
    !valueOk ||
    p.s !== expected.sort ||
    p.o !== expected.order
  ) {
    throw invalid();
  }
  return p as CursorPayload;
}

export function toSortValue(value: unknown): string | number {
  return value instanceof Date ? value.toISOString() : (value as string | number);
}

export function fromSortValue(value: string | number, type: SortType): string | number | Date {
  return type === 'date' ? new Date(value as string) : value;
}
