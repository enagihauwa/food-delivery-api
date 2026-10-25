import { buildStats, type StatusGroup } from './restaurant-stats.js';

const group = (status: StatusGroup['status'], count: number, sum: number | null): StatusGroup => ({
  status,
  _count: { _all: count },
  _sum: { totalKobo: sum },
});

describe('buildStats', () => {
  it('zero-fills every status and reports null average when there are no orders', () => {
    expect(buildStats('r1', [])).toEqual({
      restaurantId: 'r1',
      currency: 'NGN',
      orders: { total: 0, byStatus: { pending: 0, preparing: 0, out_for_delivery: 0, delivered: 0, cancelled: 0 } },
      revenueKobo: 0,
      averageOrderKobo: null,
    });
  });

  it('counts revenue from delivered orders only', () => {
    const stats = buildStats('r1', [
      group('delivered', 3, 3_000_000),
      group('cancelled', 2, 9_999_999),
      group('pending', 1, 500_000),
    ]);
    expect(stats.orders.total).toBe(6);
    expect(stats.orders.byStatus).toEqual({ pending: 1, preparing: 0, out_for_delivery: 0, delivered: 3, cancelled: 2 });
    expect(stats.revenueKobo).toBe(3_000_000);
    expect(stats.averageOrderKobo).toBe(1_000_000);
  });

  it('rounds the average to a whole kobo', () => {
    expect(buildStats('r1', [group('delivered', 3, 1_000_000)]).averageOrderKobo).toBe(333_333);
    expect(buildStats('r1', [group('delivered', 3, 1_000_001)]).averageOrderKobo).toBe(333_334);
  });

  it('has null average (not 0) when orders exist but none are delivered', () => {
    const stats = buildStats('r1', [group('pending', 4, 800_000)]);
    expect(stats.revenueKobo).toBe(0);
    expect(stats.averageOrderKobo).toBeNull();
  });
});
