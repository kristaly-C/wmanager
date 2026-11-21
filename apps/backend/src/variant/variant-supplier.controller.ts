import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../generated/prisma/enums';
import { CreateVariantSupplierDto } from './dto/create-variant-supplier.dto';
import { UpdateVariantSupplierDto } from './dto/update-variant-supplier.dto';
import { VariantSupplierService } from './variant-supplier.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('variants/:variantId')
export class VariantSupplierController {
    constructor(private readonly variantSupplierService: VariantSupplierService) {}

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
        Role.RMA_CLERK,
    )
    @Get('suppliers')
    list(
        @Param('variantId', ParseUUIDPipe) variantId: string,
        @CurrentUser() user: AuthUser,
    ) {
        return this.variantSupplierService.list(variantId, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
    )
    @Post('suppliers')
    create(
        @Param('variantId', ParseUUIDPipe) variantId: string,
        @Body() dto: CreateVariantSupplierDto,
    ) {
        return this.variantSupplierService.create(variantId, dto);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
    )
    @Patch('suppliers/:id')
    update(
        @Param('variantId', ParseUUIDPipe) variantId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateVariantSupplierDto,
    ) {
        return this.variantSupplierService.update(variantId, id, dto);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
    )
    @Delete('suppliers/:id')
    remove(
        @Param('variantId', ParseUUIDPipe) variantId: string,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        return this.variantSupplierService.remove(variantId, id);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
    )
    @Get('purchase-history')
    getPurchaseHistory(@Param('variantId', ParseUUIDPipe) variantId: string) {
        return this.variantSupplierService.getPurchaseHistory(variantId);
    }
}
