import { IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateStockReportDto {
    @IsUUID()
    variantId!: string;

    @IsUUID()
    locationId!: string;

    @IsInt()
    @Min(0)
    foundQuantity!: number;

    @IsString()
    @MinLength(1)
    @MaxLength(1000)
    reason!: string;
}
