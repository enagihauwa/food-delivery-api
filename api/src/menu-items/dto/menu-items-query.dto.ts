import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ToBoolean } from '../../common/dto/transforms.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { MenuCategory } from '../../generated/prisma/enums.js';

/** Filters for a restaurant's menu (`/restaurants/:id/menu`). */
export class RestaurantMenuQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MenuCategory, { message: `category must be one of: ${Object.values(MenuCategory).join(', ')}` })
  category?: MenuCategory;

  /** In kobo (1 naira = 100 kobo). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minPrice must be an integer number of kobo' })
  @Min(0, { message: 'minPrice must be 0 or greater' })
  minPrice?: number;

  /** In kobo (1 naira = 100 kobo). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxPrice must be an integer number of kobo' })
  @Min(0, { message: 'maxPrice must be 0 or greater' })
  maxPrice?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean({ message: 'available must be true or false' })
  available?: boolean;
}

/** Filters for the top-level `/menu-items` list. */
export class MenuItemsQueryDto extends RestaurantMenuQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'restaurantId must be a UUID' })
  restaurantId?: string;
}
