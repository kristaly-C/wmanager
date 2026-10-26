import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MinLength } from "class-validator"
import { LocationType, SlotMode } from "../../generated/prisma/enums";




export class CreateLocationDto {

    @MinLength(1)
    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsEnum(LocationType)
    type!: LocationType;

    @IsOptional()
    @IsUUID()
    parentId?: string;

    @IsOptional()
    @IsEnum(SlotMode)
    slotMode?: SlotMode;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean; 
}