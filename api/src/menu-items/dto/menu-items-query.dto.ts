import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ToBoolean } from '../../common/dto/transforms.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { MenuCategory } from '../../generated/prisma/enums.js';

const MAX_INT = 2_147_483_647; // Postgres int4 upper bound

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
  @Max(MAX_INT, { message: 'minPrice must be at most 2147483647' })
  minPrice?: number;

  /** In kobo (1 naira = 100 kobo). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxPrice must be an integer number of kobo' })
  @Min(0, { message: 'maxPrice must be 0 or greater' })
  @Max(MAX_INT, { message: 'maxPrice must be at most 2147483647' })
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
