import { OrderStatus } from '../generated/prisma/enums.js';

/** One row of `order.groupBy({ by: ['status'] })`. */
export interface StatusGroup {
  status: OrderStatus;
  _count: { _all: number };
  _sum: { totalKobo: number | null };
}

export interface RestaurantStats {
  restaurantId: string;
  currency: 'NGN';
  orders: {
    total: number;
    /** Always has every status as a key, zero when there are none. */
    byStatus: Record<OrderStatus, number>;
  };
  /** Sum of `totalKobo` over delivered orders only. Cancelled and in-progress orders are not revenue. */
  revenueKobo: number;
  /** revenueKobo / delivered orders, rounded to a whole kobo; null when nothing has been delivered. */
  averageOrderKobo: number | null;
}

export function buildStats(restaurantId: string, groups: StatusGroup[]): RestaurantStats {
  const byStatus = Object.fromEntries(Object.values(OrderStatus).map((s) => [s, 0])) as Record<OrderStatus, number>;
  let total = 0;
  for (const g of groups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  const delivered = groups.find((g) => g.status === OrderStatus.delivered);
  const revenueKobo = delivered?._sum.totalKobo ?? 0;
  const deliveredCount = byStatus.delivered;

  return {
    restaurantId,
    currency: 'NGN',
    orders: { total, byStatus },
    revenueKobo,
    averageOrderKobo: deliveredCount > 0 ? Math.round(revenueKobo / deliveredCount) : null,
  };
}
