import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUrl, IsUUID, MaxLength, Min, MinLength } from "class-validator";


export class CreateVariantDto {
    
    @IsUUID()
    productId!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    sku!: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    @MaxLength(50, { each: true })
    colors?: string[];

    @IsOptional()
    @IsString()
    @MaxLength(50)
    size?: string;

    @IsOptional()
    @Min(0)
    @IsNumber()
    weight?: number;

    @IsOptional()
    @Min(0)
    @IsNumber()
    netWeight?: number;

    @IsOptional()
    @Min(0)
    @IsNumber()
    volume?: number;

    @Min(0)
    @IsNumber()
    netPrice!: number;

    @Min(0)
    @IsNumber()
    grossPrice!: number;

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
}
