import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";


export class CreateVariantDto{
    
    @IsUUID()
    productId!: string;

    @IsString()
    @MinLength(1)
    sku!: string;

    @IsArray()
    @IsString({each: true})
    colors!: string[];

    @IsString()
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