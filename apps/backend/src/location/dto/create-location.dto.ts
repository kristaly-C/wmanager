import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
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

    @IsOptional()
    @IsBoolean()
    canFulfillWebshop?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(9999)
    fulfillmentPriority?: number;

    @IsOptional()
    @ValidateIf((_, value) => value !== null && value !== undefined)
    @IsUUID()
    dispatchHubLocationId?: string | null;

    @IsOptional()
    @IsBoolean()
    isDropoffLocation?: boolean;
}
