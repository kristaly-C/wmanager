import {
    Body,
    Controller,
    Get,
    Param,
    ParseEnumPipe,
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
import { Role, SalesChannel, SalesOrderStatus } from '../generated/prisma/enums';
import { CompleteSalesOrderDto } from './dto/complete-sales-order.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { ReassignSalesOrderLocationDto } from './dto/reassign-sales-order-location.dto';
import { RequestSalesOrderTransferDto } from './dto/request-sales-order-transfer.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderService } from './sales-order.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sales-orders')
export class SalesOrderController {
    constructor(private readonly salesOrderService: SalesOrderService) {}

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Get()
    findAll(
        @CurrentUser() user: AuthUser,
        @Query('skip') skip?: string,
        @Query('take') take?: string,
        @Query('status', new ParseEnumPipe(SalesOrderStatus, { optional: true }))
        status?: SalesOrderStatus,
        @Query('channel', new ParseEnumPipe(SalesChannel, { optional: true }))
        channel?: SalesChannel,
        @Query('sourceLocationId') sourceLocationId?: string,
        @Query('onlyProblems') onlyProblems?: string,
        @Query('search') search?: string,
    ) {
        return this.salesOrderService.findAll(user, {
            skip: skip !== undefined && skip !== '' ? Number(skip) : undefined,
            take: take !== undefined && take !== '' ? Number(take) : undefined,
            status,
            channel,
            sourceLocationId: sourceLocationId?.trim() || undefined,
            onlyProblems: onlyProblems === 'true' || onlyProblems === '1',
            search: search?.trim() || undefined,
        });
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Get('availability')
    getAvailability(
        @Query('variantIds') variantIds?: string,
        @Query('quantities') quantities?: string,
    ) {
        return this.salesOrderService.getAvailability(variantIds, quantities);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
    )
    @Get('variant-history/:variantId')
    getVariantHistory(
        @Param('variantId', ParseUUIDPipe) variantId: string,
        @CurrentUser() user: AuthUser,
        @Query('skip') skip?: string,
        @Query('take') take?: string,
    ) {
        return this.salesOrderService.getVariantHistory(variantId, user, {
            skip: skip !== undefined && skip !== '' ? Number(skip) : undefined,
            take: take !== undefined && take !== '' ? Number(take) : undefined,
        });
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Get(':id')
    findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.salesOrderService.findOne(id, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.STORE_STAFF,
    )
    @Post()
    create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser) {
        return this.salesOrderService.create(dto, user);
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
        @Body() dto: UpdateSalesOrderDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.salesOrderService.update(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/reassign-location')
    reassignLocation(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: ReassignSalesOrderLocationDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.salesOrderService.reassignLocation(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/request-transfer')
    requestTransfer(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: RequestSalesOrderTransferDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.salesOrderService.requestTransfer(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/recheck-stock')
    recheckStock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.salesOrderService.recheckStock(id, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.STORE_STAFF,
    )
    @Post(':id/complete')
    complete(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: CompleteSalesOrderDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.salesOrderService.complete(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post(':id/cancel')
    cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.salesOrderService.cancel(id, user);
    }
}
