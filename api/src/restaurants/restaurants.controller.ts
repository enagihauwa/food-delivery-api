import { Controller, Get, Param, Query } from '@nestjs/common';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe.js';
import { queryPipe } from '../common/pipes/validation.pipes.js';
import { RestaurantMenuQueryDto } from '../menu-items/dto/menu-items-query.dto.js';
import { MenuItemsService } from '../menu-items/menu-items.service.js';
import { NoQueryDto } from './dto/no-query.dto.js';
import { RestaurantsQueryDto } from './dto/restaurants-query.dto.js';
import { RestaurantsService } from './restaurants.service.js';

@Controller('restaurants')
export class RestaurantsController {
  constructor(
    private readonly restaurants: RestaurantsService,
    private readonly menuItems: MenuItemsService,
  ) {}

  @Get()
  list(@Query(queryPipe) query: RestaurantsQueryDto) {
    return this.restaurants.list(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUuidPipe('Restaurant')) id: string) {
    return this.restaurants.findOne(id);
  }

  @Get(':id/stats')
  stats(@Param('id', new ParseUuidPipe('Restaurant')) id: string, @Query(queryPipe) _query: NoQueryDto) {
    return this.restaurants.stats(id);
  }

  @Get(':id/menu')
  async menu(@Param('id', new ParseUuidPipe('Restaurant')) id: string, @Query(queryPipe) query: RestaurantMenuQueryDto) {
    await this.restaurants.findOne(id); // 404 if the restaurant does not exist
    return this.menuItems.listForRestaurant(id, query);
  }
}
