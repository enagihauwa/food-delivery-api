import { Controller, Get, Param, Query } from '@nestjs/common';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe.js';
import { queryPipe } from '../common/pipes/validation.pipes.js';
import { CustomerOrdersQueryDto } from '../orders/dto/orders-query.dto.js';
import { OrdersService } from '../orders/orders.service.js';
import { CustomersQueryDto } from './dto/customers-query.dto.js';
import { CustomersService } from './customers.service.js';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  list(@Query(queryPipe) query: CustomersQueryDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUuidPipe('Customer')) id: string) {
    return this.customers.findOne(id);
  }

  @Get(':id/orders')
  async listOrders(@Param('id', new ParseUuidPipe('Customer')) id: string, @Query(queryPipe) query: CustomerOrdersQueryDto) {
    await this.customers.findOne(id); // 404 if the customer does not exist
    return this.orders.listForCustomer(id, query);
  }
}
