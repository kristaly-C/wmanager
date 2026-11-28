import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { SalesChannel } from '../../generated/prisma/enums';

export class CreateSalesOrderItemDto {
    @IsUUID()
    variantId!: string;

    @IsInt()
    @Min(1)
    orderedQuantity!: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    unitNetPrice?: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    unitGrossPrice?: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(100)
    vatRate?: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(100)
    discountPercent?: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}

export class CreateSalesOrderDto {
    @IsOptional()
    @IsUUID()
    sourceLocationId?: string;

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

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    customerName!: string;

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
    @IsBoolean()
    instantComplete?: boolean;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSalesOrderItemDto)
    items!: CreateSalesOrderItemDto[];
}
