import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUUID, MinLength } from "class-validator";


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

    @IsNumber()
    weight!: number;

    @IsNumber()
    price!: number;

    @IsNumber()
    costPrice!: number;
    
    
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsString()
    createdAt!: string;

    @IsString()
    updatedAt!: string;
}