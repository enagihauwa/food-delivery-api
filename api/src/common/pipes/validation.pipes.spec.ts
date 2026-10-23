import type { ValidationError } from '@nestjs/common';
import { flatten } from './validation.pipes.js';

const err = (property: string, value: unknown, constraints: Record<string, string>, children: ValidationError[] = []) =>
  ({ property, value, constraints, children }) as ValidationError;

describe('flatten', () => {
  it('collapses every rule of a missing value into one "required" message', () => {
    expect(flatten([err('deliveryAddress', undefined, { a: 'too long', b: 'not empty', c: 'must be string' })])).toEqual([
      { field: 'deliveryAddress', message: 'deliveryAddress is required' },
    ]);
  });
  it('keeps the specific messages for a present-but-wrong value', () => {
    expect(flatten([err('quantity', 0, { min: 'quantity must be between 1 and 50' })])).toEqual([
      { field: 'quantity', message: 'quantity must be between 1 and 50' },
    ]);
  });
  it('builds dotted paths for nested errors', () => {
    const nested = err('items', [{}], {}, [err('0', {}, {}, [err('quantity', 0, { min: 'bad quantity' })])]);
    expect(flatten([nested])).toEqual([{ field: 'items.0.quantity', message: 'bad quantity' }]);
  });
});
