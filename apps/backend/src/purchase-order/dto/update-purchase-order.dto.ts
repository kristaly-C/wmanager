import { Type } from 'class-transformer';
import {
    IsArray,
    IsDateString,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { CreatePurchaseOrderItemDto } from './create-purchase-order.dto';

export class UpdatePurchaseOrderDto {
    @IsOptional()
    @IsUUID()
    supplierId?: string;

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
