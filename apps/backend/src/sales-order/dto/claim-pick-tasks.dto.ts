import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    ValidateNested,
} from 'class-validator';

export class ClaimPickTaskDto {
    @IsOptional()
    @IsString()
    @MaxLength(80)
    toteCode?: string;
}

export class ClaimPickTaskEntryDto {
    @IsUUID()
    pickTaskId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    toteCode?: string;
}

export class ClaimPickTasksDto {
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID(undefined, { each: true })
    pickTaskIds?: string[];

    @IsOptional()
    @IsString()
    @MaxLength(80)
    toteCode?: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ClaimPickTaskEntryDto)
    tasks?: ClaimPickTaskEntryDto[];
}

export class UpdatePickTaskToteDto {
    @IsOptional()
    @IsString()
    @MaxLength(80)
    toteCode?: string | null;
}
