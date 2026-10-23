import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors/app-exception.js';
import { paginate, type SortMap } from '../common/pagination/paginate.js';
import { escapeLike } from '../common/utils/escape-like.js';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CustomersQueryDto } from './dto/customers-query.dto.js';

export const CUSTOMER_SORT: SortMap = {
  name: { column: 'name', type: 'string' },
  createdAt: { column: 'createdAt', type: 'date' },
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  list(query: CustomersQueryDto) {
    return paginate({
      delegate: this.prisma.customer,
      where: {
        ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
        ...(query.q ? { name: { contains: escapeLike(query.q), mode: 'insensitive' } } : {}),
      },
      sortMap: CUSTOMER_SORT,
      defaultSort: 'createdAt',
      query,
      limits: this.config.get('pagination', { infer: true }),
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw AppException.notFound('Customer');
    return customer;
  }
}
