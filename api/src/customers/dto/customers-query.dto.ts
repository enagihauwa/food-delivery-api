import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

export class CustomersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  /** Case-insensitive substring match on the customer name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
