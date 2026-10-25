import { Module } from '@nestjs/common';
import { MenuItemsModule } from '../menu-items/menu-items.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { RestaurantsController } from './restaurants.controller.js';
import { RestaurantsService } from './restaurants.service.js';

@Module({
  imports: [MenuItemsModule, OrdersModule],
  controllers: [RestaurantsController],
  providers: [RestaurantsService],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
