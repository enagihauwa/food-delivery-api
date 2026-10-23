import { buildDataset } from './seed.js';

describe('seed dataset', () => {
  const a = buildDataset();
  const b = buildDataset();

  it('is deterministic across runs', () => {
    expect(b).toEqual(a);
  });

  it('has realistic volume (hundreds per core resource)', () => {
    expect(a.customers.length).toBeGreaterThanOrEqual(300);
    expect(a.restaurants.length).toBeGreaterThanOrEqual(300);
    expect(a.menuItems.length).toBeGreaterThanOrEqual(300);
    expect(a.orders.length).toBeGreaterThanOrEqual(300);
  });

  it('uses unique UUIDs and unique customer emails', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const rows of Object.values(a)) {
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((i) => uuid.test(i))).toBe(true);
    }
    const emails = a.customers.map((c) => c.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('stores prices as positive integer kobo', () => {
    for (const m of a.menuItems) {
      expect(Number.isInteger(m.priceKobo)).toBe(true);
      expect(m.priceKobo).toBeGreaterThan(0);
    }
  });

  it('keeps relationships consistent', () => {
    const restaurants = new Set(a.restaurants.map((r) => r.id));
    const customers = new Set(a.customers.map((c) => c.id));
    const menuById = new Map(a.menuItems.map((m) => [m.id, m]));
    const orderById = new Map(a.orders.map((o) => [o.id, o]));

    expect(a.menuItems.every((m) => restaurants.has(m.restaurantId))).toBe(true);
    expect(a.orders.every((o) => restaurants.has(o.restaurantId) && customers.has(o.customerId))).toBe(true);

    for (const i of a.orderItems) {
      const order = orderById.get(i.orderId)!;
      const menu = menuById.get(i.menuItemId)!;
      expect(menu.restaurantId).toBe(order.restaurantId);
      expect(i.unitPriceKobo).toBe(menu.priceKobo);
    }
  });

  it('computes each order total from its items', () => {
    const totals = new Map<string, number>();
    for (const i of a.orderItems) totals.set(i.orderId, (totals.get(i.orderId) ?? 0) + i.quantity * i.unitPriceKobo);
    for (const o of a.orders) expect(o.totalKobo).toBe(totals.get(o.id));
  });
});
