import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";


export class CreateSupplierDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    phone?: string;

    @IsOptional()
    @IsEmail()
    @MaxLength(255)
    email?: string;
}
