import { IsString, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class CreateCategoryDto {
    @IsString()
    name!: string;

    @IsOptional()
    @IsUUID()
    parentId?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}