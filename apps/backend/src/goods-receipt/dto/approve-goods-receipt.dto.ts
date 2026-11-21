import { Type } from 'class-transformer';
import {
    IsArray,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * Egy adott bevételezési tétel egységárának vezetői felülírása jóváhagyáskor.
 * Az `unitCost` a bizonylat (`GoodsReceipt.currency`) pénznemében értendő;
 * a rendszer ebből számolja ki az új `unitCostHuf = round(unitCost * receipt.exchangeRate, 2)` értéket.
 */
export class GoodsReceiptItemCostOverrideDto {
    @IsUUID()
    goodsReceiptItemId!: string;

    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    unitCost!: number;
}

export class ApproveGoodsReceiptDto {
    @IsOptional()
    @IsString()
    discrepancyNote?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => GoodsReceiptItemCostOverrideDto)
    itemCostOverrides?: GoodsReceiptItemCostOverrideDto[];
}
