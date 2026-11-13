import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LocationType, SlotMode } from '../../generated/prisma/enums';

export class BulkLocationItemDto {
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
  @IsEnum(SlotMode)
  slotMode?: SlotMode;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkLocationItemDto)
  children?: BulkLocationItemDto[];
}

export class BulkCreateLocationsDto {
  @IsUUID()
  parentId!: string;

  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkLocationItemDto)
  items?: BulkLocationItemDto[];

  @ValidateIf((o) => !o.items)
  @IsEnum(LocationType)
  type?: LocationType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  suffix?: string;

  @ValidateIf((o) => !o.items)
  @IsInt()
  @Min(0)
  @Max(9999)
  start?: number;

  @ValidateIf((o) => !o.items)
  @IsInt()
  @Min(0)
  @Max(9999)
  end?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  padLength?: number;

  @IsOptional()
  @IsEnum(SlotMode)
  slotMode?: SlotMode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
