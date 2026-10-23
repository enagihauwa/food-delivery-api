import { Controller, Get, Param, Query } from '@nestjs/common';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe.js';
import { queryPipe } from '../common/pipes/validation.pipes.js';
import { MenuItemsQueryDto } from './dto/menu-items-query.dto.js';
import { MenuItemsService } from './menu-items.service.js';

@Controller('menu-items')
export class MenuItemsController {
  constructor(private readonly menuItems: MenuItemsService) {}

  @Get()
  list(@Query(queryPipe) query: MenuItemsQueryDto) {
    return this.menuItems.list(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUuidPipe('Menu item')) id: string) {
    return this.menuItems.findOne(id);
  }
}
