import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";


export class CreateVariantDto {
    
    @IsUUID()
    productId!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    sku!: string;

    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    @MaxLength(50, { each: true })
    colors!: string[];

    @IsString()
    @MinLength(1)
    @MaxLength(50)
    size!: string;

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
    @IsBoolean()
    isActive?: boolean;
}
