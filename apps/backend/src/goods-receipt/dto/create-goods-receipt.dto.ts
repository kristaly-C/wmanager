import { Type } from 'class-transformer';
import {
    IsArray,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

export class CreateGoodsReceiptItemDto {
    @IsUUID()
    variantId!: string;

    @IsOptional()
    @IsUUID()
    purchaseOrderItemId?: string;

    @IsInt()
    @Min(1)
    expectedQuantity!: number;

    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    unitCost!: number;

    @IsOptional()
    @IsUUID()
    expectedLocationId?: string;

    @IsOptional()
    @IsString()
    note?: string;
}

export class CreateGoodsReceiptDto {
    @IsUUID()
    targetLocationId!: string;

    @IsOptional()
    @IsUUID()
    purchaseOrderId?: string;

    @IsOptional()
    @IsUUID()
    supplierId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    invoiceNumber?: string;

    @IsOptional()
    @IsString()
    @Length(3, 3)
    currency?: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 4 })
    @Min(0.0001)
    exchangeRate?: number;

    @IsOptional()
    @IsString()
    note?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateGoodsReceiptItemDto)
    items?: CreateGoodsReceiptItemDto[];
}
