interface OrderRow {
  id: string;
  customerId: string;
  restaurantId: string;
  status: string;
  deliveryAddress: string;
  totalKobo: number;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<{
    id: string;
    menuItemId: string;
    quantity: number;
    unitPriceKobo: number;
    menuItem: { name: string };
  }>;
}

/** Public order shape. `items` is only present when the order was loaded with them. */
export function toOrderDto(order: OrderRow) {
  const { items, ...rest } = order;
  return {
    id: rest.id,
    customerId: rest.customerId,
    restaurantId: rest.restaurantId,
    status: rest.status,
    deliveryAddress: rest.deliveryAddress,
    currency: 'NGN' as const,
    totalKobo: rest.totalKobo,
    ...(items
      ? {
          items: items.map((i) => ({
            id: i.id,
            menuItemId: i.menuItemId,
            name: i.menuItem.name,
            quantity: i.quantity,
            unitPriceKobo: i.unitPriceKobo,
          })),
        }
      : {}),
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
  };
}

export const ORDER_WITH_ITEMS = {
  items: { include: { menuItem: { select: { name: true } } }, orderBy: { id: 'asc' as const } },
};
