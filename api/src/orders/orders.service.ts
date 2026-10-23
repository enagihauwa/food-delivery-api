import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, type ErrorDetail } from '../common/errors/app-exception.js';
import { paginate, type SortMap } from '../common/pagination/paginate.js';
import { Paginated } from '../common/pagination/paginated.js';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateOrderDto, UpdateOrderDto } from './dto/order-body.dto.js';
import type { CustomerOrdersQueryDto, OrdersQueryDto } from './dto/orders-query.dto.js';
import { canEditAddress, canTransition } from './order-status.js';
import { ORDER_WITH_ITEMS, toOrderDto } from './order.mapper.js';

export const ORDER_SORT: SortMap = {
  createdAt: { column: 'createdAt', type: 'date' },
  total: { column: 'totalKobo', type: 'number' },
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  list(query: OrdersQueryDto) {
    const { minTotal, maxTotal } = query;
    if (minTotal !== undefined && maxTotal !== undefined && minTotal > maxTotal) {
      throw AppException.badRequest('minTotal must not be greater than maxTotal', [
        { field: 'minTotal', message: 'must not be greater than maxTotal' },
      ]);
    }
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? this.endOfDayIfDateOnly(query.to) : undefined;
    if (from && to && from > to) {
      throw AppException.badRequest('from must not be after to', [{ field: 'from', message: 'must not be after to' }]);
    }

    const total = {
      ...(minTotal !== undefined ? { gte: minTotal } : {}),
      ...(maxTotal !== undefined ? { lte: maxTotal } : {}),
    };
    const created = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    return this.page({
      ...(query.status ? { status: query.status } : {}),
      ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(Object.keys(total).length ? { totalKobo: total } : {}),
      ...(Object.keys(created).length ? { createdAt: created } : {}),
    }, query);
  }

  listForCustomer(customerId: string, query: CustomerOrdersQueryDto) {
    return this.page({ customerId, ...(query.status ? { status: query.status } : {}) }, query);
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_WITH_ITEMS });
    if (!order) throw AppException.notFound('Order');
    return toOrderDto(order);
  }

  async create(dto: CreateOrderDto) {
    const problems: ErrorDetail[] = [];

    const ids = dto.items.map((i) => i.menuItemId);
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) {
        problems.push({ field: `items.${index}.menuItemId`, message: 'duplicate menuItemId; combine into one line using quantity' });
      }
    });

    const [customer, restaurant, menuItems] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId }, select: { id: true } }),
      this.prisma.restaurant.findUnique({ where: { id: dto.restaurantId }, select: { id: true, isOpen: true } }),
      this.prisma.menuItem.findMany({ where: { id: { in: ids } } }),
    ]);

    if (!customer) problems.push({ field: 'customerId', message: 'customer not found' });
    if (!restaurant) problems.push({ field: 'restaurantId', message: 'restaurant not found' });
    else if (!restaurant.isOpen) problems.push({ field: 'restaurantId', message: 'restaurant is currently closed' });

    const byId = new Map(menuItems.map((m) => [m.id, m]));
    dto.items.forEach((line, index) => {
      const field = `items.${index}.menuItemId`;
      const item = byId.get(line.menuItemId);
      if (!item) problems.push({ field, message: 'menu item not found' });
      else if (restaurant && item.restaurantId !== restaurant.id) problems.push({ field, message: 'menu item does not belong to this restaurant' });
      else if (!item.available) problems.push({ field, message: 'menu item is not available' });
    });

    if (problems.length) throw AppException.validation('Order cannot be created', problems);

    const lines = dto.items.map((line) => ({
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      unitPriceKobo: byId.get(line.menuItemId)!.priceKobo,
    }));
    const totalKobo = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceKobo, 0);

    const order = await this.prisma.order.create({
      data: {
        customerId: dto.customerId,
        restaurantId: dto.restaurantId,
        deliveryAddress: dto.deliveryAddress.trim(),
        totalKobo,
        items: { create: lines },
      },
      include: ORDER_WITH_ITEMS,
    });
    return toOrderDto(order);
  }

  async update(id: string, dto: UpdateOrderDto) {
    if (dto.status === undefined && dto.deliveryAddress === undefined) {
      throw AppException.validation('Request body is invalid', [
        { field: 'status', message: 'provide status and/or deliveryAddress' },
      ]);
    }

    const current = await this.prisma.order.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw AppException.notFound('Order');

    if (dto.status !== undefined && !canTransition(current.status, dto.status)) {
      throw AppException.conflict(`Cannot change order from '${current.status}' to '${dto.status}'`, 'INVALID_STATUS_TRANSITION');
    }
    if (dto.deliveryAddress !== undefined && !canEditAddress(current.status)) {
      throw AppException.conflict(`Cannot change the delivery address of an order that is '${current.status}'`);
    }

    // Guard on the status we validated against so two concurrent updates cannot both win.
    const { count } = await this.prisma.order.updateMany({
      where: { id, status: current.status },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.deliveryAddress !== undefined ? { deliveryAddress: dto.deliveryAddress.trim() } : {}),
      },
    });
    if (count === 0) {
      // Someone else changed or deleted it between our read and write.
      const exists = await this.prisma.order.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw AppException.notFound('Order');
      throw AppException.conflict('Order was modified by another request; reload and try again');
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.order.deleteMany({ where: { id } });
    if (count === 0) throw AppException.notFound('Order');
  }

  private async page(where: Record<string, unknown>, query: OrdersQueryDto | CustomerOrdersQueryDto) {
    const page = await paginate({
      delegate: this.prisma.order,
      where,
      sortMap: ORDER_SORT,
      defaultSort: 'createdAt',
      query,
      limits: this.config.get('pagination', { infer: true }),
    });
    return new Paginated(page.items.map(toOrderDto), page.meta);
  }

  /** `to=2026-03-31` means "through the end of that day"; full timestamps are used as given. */
  private endOfDayIfDateOnly(value: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
  }
}
