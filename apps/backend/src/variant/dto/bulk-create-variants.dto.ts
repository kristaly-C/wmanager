import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    IsUrl,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';

export class BulkVariantItemDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    sku!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(50)
    size!: string;

    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    @MaxLength(50, { each: true })
    colors!: string[];

    @Min(0)
    @IsNumber()
    weight!: number;

    @Min(0)
    @IsNumber()
    price!: number;

    @Min(0)
    @IsNumber()
    costPrice!: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
    @MaxLength(2048, { each: true })
    imageUrls?: string[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    primaryBarcode?: string;
}

export class BulkCreateVariantsDto {
    @IsUUID()
    productId!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => BulkVariantItemDto)
    items!: BulkVariantItemDto[];
}
