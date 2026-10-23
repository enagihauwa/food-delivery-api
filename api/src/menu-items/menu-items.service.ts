import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { AppException } from '../common/errors/app-exception.js';
import { paginate, type SortMap } from '../common/pagination/paginate.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MenuItemsQueryDto, RestaurantMenuQueryDto } from './dto/menu-items-query.dto.js';

export const MENU_SORT: SortMap = {
  name: { column: 'name', type: 'string' },
  price: { column: 'priceKobo', type: 'number' },
  createdAt: { column: 'createdAt', type: 'date' },
};

@Injectable()
export class MenuItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  list(query: MenuItemsQueryDto) {
    return this.page(query, query.restaurantId);
  }

  listForRestaurant(restaurantId: string, query: RestaurantMenuQueryDto) {
    return this.page(query, restaurantId);
  }

  async findOne(id: string) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw AppException.notFound('Menu item');
    return item;
  }

  private page(query: RestaurantMenuQueryDto, restaurantId?: string) {
    const { minPrice, maxPrice } = query;
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw AppException.badRequest('minPrice must not be greater than maxPrice', [
        { field: 'minPrice', message: 'must not be greater than maxPrice' },
      ]);
    }
    const price = {
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    };
    return paginate({
      delegate: this.prisma.menuItem,
      where: {
        ...(restaurantId ? { restaurantId } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.available !== undefined ? { available: query.available } : {}),
        ...(Object.keys(price).length ? { priceKobo: price } : {}),
      },
      sortMap: MENU_SORT,
      defaultSort: 'createdAt',
      query,
      limits: this.config.get('pagination', { infer: true }),
    });
  }
}
