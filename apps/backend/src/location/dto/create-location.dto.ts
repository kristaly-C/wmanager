import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { LocationType, SlotMode } from "../../generated/prisma/enums";


export class CreateLocationDto {

    @MinLength(1)
    @MaxLength(150)
    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
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
