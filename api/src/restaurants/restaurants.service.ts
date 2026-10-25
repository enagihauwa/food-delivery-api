import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { AppException } from '../common/errors/app-exception.js';
import { escapeLike } from '../common/utils/escape-like.js';
import { paginate, type SortMap } from '../common/pagination/paginate.js';
import { buildStats, type StatusGroup } from './restaurant-stats.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RestaurantsQueryDto } from './dto/restaurants-query.dto.js';

export const RESTAURANT_SORT: SortMap = {
  name: { column: 'name', type: 'string' },
  rating: { column: 'rating', type: 'number' },
  createdAt: { column: 'createdAt', type: 'date' },
};

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  list(query: RestaurantsQueryDto) {
    return paginate({
      delegate: this.prisma.restaurant,
      where: {
        ...(query.cuisine ? { cuisine: query.cuisine } : {}),
        ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
        ...(query.minRating !== undefined ? { rating: { gte: query.minRating } } : {}),
        ...(query.isOpen !== undefined ? { isOpen: query.isOpen } : {}),
        ...(query.q ? { name: { contains: escapeLike(query.q), mode: 'insensitive' } } : {}),
      },
      sortMap: RESTAURANT_SORT,
      defaultSort: 'createdAt',
      query,
      limits: this.config.get('pagination', { infer: true }),
    });
  }

  async findOne(id: string) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id } });
    if (!restaurant) throw AppException.notFound('Restaurant');
    return restaurant;
  }

  /** Order counts per status plus revenue (delivered only), from a single grouped query. */
  async stats(id: string) {
    await this.findOne(id); // 404 if the restaurant does not exist
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { restaurantId: id },
      _count: { _all: true },
      _sum: { totalKobo: true },
    });
    return buildStats(id, groups as StatusGroup[]);
  }
}
