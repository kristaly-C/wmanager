import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class PickItemDto {
    @IsOptional()
    @IsUUID()
    pickTaskItemId?: string;

    @IsOptional()
    @IsUUID()
    variantId?: string;

    @IsOptional()
    @IsString()
    barcode?: string;

    @IsOptional()
    @IsString()
    sku?: string;

    @IsOptional()
    @IsUUID()
    locationId?: string;

    @IsOptional()
    @IsString()
    locationName?: string;

    @IsInt()
    @Min(1)
    quantity!: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}
