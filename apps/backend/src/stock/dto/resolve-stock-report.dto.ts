import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveStockReportDto {
    @IsIn(['APPROVE', 'REJECT'])
    action!: 'APPROVE' | 'REJECT';

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    resolutionNote?: string;
}
