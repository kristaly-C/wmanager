import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../generated/prisma/enums';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderService } from './purchase-order.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('purchase-orders')
export class PurchaseOrderController {
    constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Get()
    findAll(
        @Query('skip') skip?: string,
        @Query('take') take?: string,
        @Query('status') status?: string,
        @Query('supplierId') supplierId?: string,
        @Query('search') search?: string,
    ) {
        return this.purchaseOrderService.findAll({
            skip: skip !== undefined && skip !== '' ? Number(skip) : undefined,
            take: take !== undefined && take !== '' ? Number(take) : undefined,
            status,
            supplierId,
            search,
        });
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Get(':id')
    findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.purchaseOrderService.findOne(id);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post()
    create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: AuthUser) {
        return this.purchaseOrderService.create(dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Patch(':id')
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdatePurchaseOrderDto,
    ) {
        return this.purchaseOrderService.update(id, dto);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/order')
    order(@Param('id', ParseUUIDPipe) id: string) {
        return this.purchaseOrderService.order(id);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/confirm')
    confirm(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: ConfirmPurchaseOrderDto,
    ) {
        return this.purchaseOrderService.confirm(id, dto);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/close')
    close(@Param('id', ParseUUIDPipe) id: string) {
        return this.purchaseOrderService.close(id);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/cancel')
    cancel(@Param('id', ParseUUIDPipe) id: string) {
        return this.purchaseOrderService.cancel(id);
    }
}
