import { Type } from 'class-transformer';
import {
    IsArray,
    IsDateString,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

export class CreatePurchaseOrderItemDto {
    @IsUUID()
    variantId!: string;

    @IsInt()
    @Min(1, { message: 'A rendelt mennyiség legalább 1 kell legyen' })
    orderedQuantity!: number;

    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'Az egységár nem lehet negatív' })
    unitCost!: number;

    @IsOptional()
    @IsString()
    note?: string | null;
}

export class CreatePurchaseOrderDto {
    @IsUUID()
    supplierId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(10)
    currency?: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 4 })
    @Min(0.0001, { message: 'Az árfolyam pozitív szám kell legyen' })
    exchangeRate?: number;

    @IsOptional()
    @IsString()
    supplierReference?: string | null;

    @IsOptional()
    @IsDateString()
    expectedDeliveryDate?: string | null;

    @IsOptional()
    @IsString()
    note?: string | null;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePurchaseOrderItemDto)
    items?: CreatePurchaseOrderItemDto[];
}
