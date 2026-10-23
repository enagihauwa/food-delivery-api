import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe.js';
import { bodyPipe, queryPipe } from '../common/pipes/validation.pipes.js';
import { CreateOrderDto, UpdateOrderDto } from './dto/order-body.dto.js';
import { OrdersQueryDto } from './dto/orders-query.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query(queryPipe) query: OrdersQueryDto) {
    return this.orders.list(query);
  }

  @Post()
  async create(@Body(bodyPipe) dto: CreateOrderDto, @Res({ passthrough: true }) res: Response) {
    const order = await this.orders.create(dto);
    res.location(`/api/v1/orders/${order.id}`);
    return order;
  }

  @Get(':id')
  findOne(@Param('id', new ParseUuidPipe('Order')) id: string) {
    return this.orders.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', new ParseUuidPipe('Order')) id: string, @Body(bodyPipe) dto: UpdateOrderDto) {
    return this.orders.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUuidPipe('Order')) id: string) {
    return this.orders.remove(id);
  }
}
