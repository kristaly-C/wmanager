import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ReportPickShortageDto {
    @IsUUID()
    variantId!: string;

    @IsUUID()
    locationId!: string;

    @IsInt()
    @Min(0)
    foundQuantity!: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
