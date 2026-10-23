import type { OrderStatus } from '../generated/prisma/enums.js';
import { canEditAddress, canTransition } from './order-status.js';

const ALL: OrderStatus[] = ['pending', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

describe('order status rules', () => {
  it.each([
    ['pending', 'preparing'],
    ['pending', 'cancelled'],
    ['preparing', 'out_for_delivery'],
    ['preparing', 'cancelled'],
    ['out_for_delivery', 'delivered'],
  ] as const)('allows %s -> %s', (from, to) => expect(canTransition(from, to)).toBe(true));

  it.each([
    ['pending', 'delivered'],
    ['pending', 'out_for_delivery'],
    ['preparing', 'pending'],
    ['out_for_delivery', 'cancelled'],
    ['delivered', 'pending'],
    ['delivered', 'cancelled'],
    ['cancelled', 'pending'],
  ] as const)('forbids %s -> %s', (from, to) => expect(canTransition(from, to)).toBe(false));

  it('treats the same status as a no-op for every status', () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(true);
  });

  it('allows address edits only before dispatch', () => {
    expect(ALL.filter(canEditAddress)).toEqual(['pending', 'preparing']);
  });
});
