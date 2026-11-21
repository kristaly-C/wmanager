import { Type } from 'class-transformer';
import {
    IsArray,
    IsDateString,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator';

export class ConfirmPurchaseOrderItemDto {
    @IsOptional()
    @IsUUID()
    itemId?: string;

    @IsOptional()
    @IsUUID()
    variantId?: string;

    @IsInt()
    @Min(0, { message: 'A visszaigazolt mennyiség nem lehet negatív' })
    confirmedQuantity!: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'Az egységár nem lehet negatív' })
    unitCost?: number;

    @IsOptional()
    @IsString()
    note?: string | null;
}

export class ConfirmPurchaseOrderDto {
    @IsOptional()
    @IsDateString()
    expectedDeliveryDate?: string | null;

    @IsOptional()
    @IsString()
    supplierReference?: string | null;

    @IsOptional()
    @IsString()
    note?: string | null;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ConfirmPurchaseOrderItemDto)
    items?: ConfirmPurchaseOrderItemDto[];
}
