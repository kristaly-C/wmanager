import {
    Body,
    Controller,
    Get,
    Param,
    ParseEnumPipe,
    ParseUUIDPipe,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GoodsReceiptStatus, Role } from '../generated/prisma/enums';
import { AddGoodsReceiptItemDto } from './dto/add-goods-receipt-item.dto';
import { ApproveGoodsReceiptDto } from './dto/approve-goods-receipt.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { PutawayDto } from './dto/putaway.dto';
import { GoodsReceiptService } from './goods-receipt.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('goods-receipts')
export class GoodsReceiptController {
    constructor(private readonly goodsReceiptService: GoodsReceiptService) {}

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Get()
    findAll(
        @CurrentUser() user: AuthUser,
        @Query('status', new ParseEnumPipe(GoodsReceiptStatus, { optional: true }))
        status?: GoodsReceiptStatus,
        @Query('locationId') locationId?: string,
        @Query('purchaseOrderId') purchaseOrderId?: string,
        @Query('supplierId') supplierId?: string,
        @Query('search') search?: string,
        @Query('skip') skip?: string,
        @Query('take') take?: string,
    ) {
        return this.goodsReceiptService.findAll(user, {
            status,
            locationId: locationId?.trim() || undefined,
            purchaseOrderId: purchaseOrderId?.trim() || undefined,
            supplierId: supplierId?.trim() || undefined,
            search: search?.trim() || undefined,
            skip: skip !== undefined ? Number(skip) : undefined,
            take: take !== undefined ? Number(take) : undefined,
        });
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Get(':id')
    findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.goodsReceiptService.findOne(id, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
    )
    @Post()
    create(@Body() dto: CreateGoodsReceiptDto, @CurrentUser() user: AuthUser) {
        return this.goodsReceiptService.create(dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.ORDER_CLERK,
    )
    @Post(':id/items')
    addOrUpdateItem(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: AddGoodsReceiptItemDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.goodsReceiptService.addOrUpdateItem(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/start')
    start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.goodsReceiptService.start(id, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/putaway')
    putaway(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: PutawayDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.goodsReceiptService.putaway(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/putaway/:movementId/undo')
    undoPutaway(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('movementId', ParseUUIDPipe) movementId: string,
        @CurrentUser() user: AuthUser,
    ) {
        return this.goodsReceiptService.undoPutaway(id, movementId, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/finish')
    finish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.goodsReceiptService.finish(id, user);
    }

    @Roles(Role.BOSS, Role.ADMIN, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER)
    @Post(':id/approve')
    approve(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: ApproveGoodsReceiptDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.goodsReceiptService.approve(id, dto, user);
    }

    @Roles(Role.BOSS, Role.ADMIN, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER)
    @Post(':id/cancel')
    cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.goodsReceiptService.cancel(id, user);
    }
}
