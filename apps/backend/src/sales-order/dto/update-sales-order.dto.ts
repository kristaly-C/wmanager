import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsEnum,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { SalesChannel } from '../../generated/prisma/enums';
import { CreateSalesOrderItemDto } from './create-sales-order.dto';

export class UpdateSalesOrderDto {
    @IsOptional()
    @IsEnum(SalesChannel)
    channel?: SalesChannel;

    @IsOptional()
    @IsBoolean()
    isPickup?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    externalOrderRef?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    customerName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    customerEmail?: string;

    @IsOptional()
    @IsString()
    @MaxLength(60)
    customerPhone?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    shippingAddress?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    holdReason?: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSalesOrderItemDto)
    items?: CreateSalesOrderItemDto[];
}
