import { IsString, IsOptional, IsUUID, IsBoolean, MinLength, MaxLength } from 'class-validator';

export class CreateCategoryDto {
    @IsString()
    @MinLength(1)
    @MaxLength(150)
    name!: string;

    @IsOptional()
    @IsUUID()
    parentId?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
