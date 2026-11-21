import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateVariantSupplierDto } from './create-variant-supplier.dto';

export class UpdateVariantSupplierDto extends PartialType(
    OmitType(CreateVariantSupplierDto, ['supplierId'] as const),
) {}
