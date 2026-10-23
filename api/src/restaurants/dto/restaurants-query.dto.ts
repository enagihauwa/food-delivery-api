import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ToBoolean } from '../../common/dto/transforms.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { Cuisine } from '../../generated/prisma/enums.js';

export class RestaurantsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(Cuisine, { message: `cuisine must be one of: ${Object.values(Cuisine).join(', ')}` })
  cuisine?: Cuisine;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minRating must be a number' })
  @Min(0, { message: 'minRating must be between 0 and 5' })
  @Max(5, { message: 'minRating must be between 0 and 5' })
  minRating?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean({ message: 'isOpen must be true or false' })
  isOpen?: boolean;

  /** Case-insensitive substring match on the restaurant name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
