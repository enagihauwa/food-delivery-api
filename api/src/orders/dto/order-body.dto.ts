import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderStatus } from '../../generated/prisma/enums.js';

export class OrderItemInputDto {
  @IsUUID(undefined, { message: 'menuItemId must be a UUID' })
  menuItemId!: string;

  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be between 1 and 50' })
  @Max(50, { message: 'quantity must be between 1 and 50' })
  quantity!: number;
}

export class CreateOrderDto {
  @IsUUID(undefined, { message: 'customerId is required and must be a UUID' })
  customerId!: string;

  @IsUUID(undefined, { message: 'restaurantId is required and must be a UUID' })
  restaurantId!: string;

  @IsString({ message: 'deliveryAddress is required' })
  @IsNotEmpty({ message: 'deliveryAddress is required' })
  @MaxLength(250, { message: 'deliveryAddress must be at most 250 characters' })
  deliveryAddress!: string;

  @IsArray({ message: 'items is required and must be an array' })
  @ArrayMinSize(1, { message: 'items must contain at least 1 item' })
  @ArrayMaxSize(50, { message: 'items must contain at most 50 items' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}

/** Only these two fields can change after creation; totals are always server computed. */
export class UpdateOrderDto {
  @IsOptional()
  @IsEnum(OrderStatus, { message: `status must be one of: ${Object.values(OrderStatus).join(', ')}` })
  status?: OrderStatus;

  @IsOptional()
  @IsString({ message: 'deliveryAddress must be a string' })
  @IsNotEmpty({ message: 'deliveryAddress must not be empty' })
  @MaxLength(250, { message: 'deliveryAddress must be at most 250 characters' })
  deliveryAddress?: string;
}
