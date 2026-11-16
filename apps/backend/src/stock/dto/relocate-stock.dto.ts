import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class RelocateStockDto {
    @IsUUID()
    variantId!: string;

    @IsUUID()
    fromLocationId!: string;

    @IsUUID()
    toLocationId!: string;

    @IsInt()
    @Min(1)
    quantity!: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}
