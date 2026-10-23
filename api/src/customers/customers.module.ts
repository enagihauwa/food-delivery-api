import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({
  imports: [OrdersModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
