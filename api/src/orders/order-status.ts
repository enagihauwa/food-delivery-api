import type { OrderStatus } from '../generated/prisma/enums.js';

/** pending -> preparing -> out_for_delivery -> delivered; pending/preparing can be cancelled. */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Setting the status an order already has is an allowed no-op, so retried PATCH requests are safe. */
export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  from === to || ALLOWED_TRANSITIONS[from].includes(to);

/** The delivery address can only change before the order leaves the kitchen. */
export const canEditAddress = (status: OrderStatus): boolean => status === 'pending' || status === 'preparing';
