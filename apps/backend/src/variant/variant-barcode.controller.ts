import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { VariantBarcodeService } from "./variant-barcode.service";
import { CreateVariantBarcodeDto } from "./dto/create-variant-barcode.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";
import { UpdateVariantBarcodeDto } from "./dto/update-variant-barcode.dto";



@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('variants/:variantId/barcodes')
export class VariantBarcodeController {
    constructor(private variantBarcodeService: VariantBarcodeService) {}

    @Get()
    list(@Param('variantId') variantId: string){
        return this.variantBarcodeService.list(variantId)
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Post()
    create(
        @Param('variantId') variantId: string,
        @Body() dto: CreateVariantBarcodeDto
    ){
        return this.variantBarcodeService.create(variantId, dto)
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Patch(':barcodeId')
    update(
        @Param('variantId') variantId: string,
        @Param('barcodeId') barcodeId: string,
        @Body() dto: UpdateVariantBarcodeDto,
    ) {
        return this.variantBarcodeService.update(variantId,barcodeId,dto);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Delete(':barcodeId')
    remove(
        @Param('variantId') variantId: string,
        @Param('barcodeId') barcodeId: string
    ){
        return this.variantBarcodeService.remove(variantId, barcodeId);
    }
}