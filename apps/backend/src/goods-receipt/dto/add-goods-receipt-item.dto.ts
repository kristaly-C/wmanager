import {
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
} from 'class-validator';

export class AddGoodsReceiptItemDto {
    @IsUUID()
    variantId!: string;

    @IsOptional()
    @IsUUID()
    purchaseOrderItemId?: string;

    @IsInt()
    @Min(0)
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
