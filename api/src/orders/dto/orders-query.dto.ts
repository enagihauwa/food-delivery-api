import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { OrderStatus } from '../../generated/prisma/enums.js';

const MAX_INT = 2_147_483_647; // Postgres int4 upper bound

/** Filters for `/customers/:id/orders`. */
export class CustomerOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus, { message: `status must be one of: ${Object.values(OrderStatus).join(', ')}` })
  status?: OrderStatus;
}

/** Filters for `/orders`. Money values are in kobo. */
export class OrdersQueryDto extends CustomerOrdersQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'restaurantId must be a UUID' })
  restaurantId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'customerId must be a UUID' })
  customerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minTotal must be an integer number of kobo' })
  @Min(0, { message: 'minTotal must be 0 or greater' })
  @Max(MAX_INT, { message: 'minTotal must be at most 2147483647' })
  minTotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxTotal must be an integer number of kobo' })
  @Min(0, { message: 'maxTotal must be 0 or greater' })
  @Max(MAX_INT, { message: 'maxTotal must be at most 2147483647' })
  maxTotal?: number;

  /** Orders created at or after this ISO 8601 timestamp. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from must be an ISO 8601 date, e.g. 2026-03-01 or 2026-03-01T00:00:00Z' })
  from?: string;

  /** Orders created at or before this ISO 8601 timestamp. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to must be an ISO 8601 date, e.g. 2026-03-31 or 2026-03-31T23:59:59Z' })
  to?: string;
}
