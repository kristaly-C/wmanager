import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { StockService } from "./stock.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthUser, CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role, MovementType, StockReportStatus } from "../generated/prisma/enums";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { RelocateStockDto } from "./dto/relocate-stock.dto";
import { UpdateStockSettingsDto } from "./dto/update-stock-settings.dto";
import { CreateStockReportDto } from "./dto/create-stock-report.dto";
import { ResolveStockReportDto } from "./dto/resolve-stock-report.dto";


@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock')
export class StockController{
    constructor(private readonly stockService: StockService){}


    @Get()
    findAll(
        @CurrentUser() user: AuthUser,
        @Query('locationId') locationId?: string,
        @Query('variantId') variantId?: string,
        @Query('productId') productId?: string,
        @Query('search') search?: string,
        @Query('skip') skip?: string,
        @Query('take') take?: string,
    ) {
        return this.stockService.findAll(user, {
            locationId,
            variantId,
            productId,
            search,
            skip: skip !== undefined ? Number(skip) : undefined,
            take: take !== undefined ? Number(take) : undefined,
        });
    }

    @Get('movements')
    findMovements(
        @CurrentUser() user: AuthUser,
        @Query('locationId') locationId?: string,
        @Query('variantId') variantId?: string,
        @Query('productId') productId?: string,
        @Query('type') type?: MovementType,
        @Query('search') search?: string,
        @Query('skip') skip?: string,
        @Query('take') take?: string,
    ) {
        return this.stockService.findMovements(user, {
            locationId,
            variantId,
            productId,
            type,
            search,
            skip: skip !== undefined ? Number(skip) : undefined,
            take: take !== undefined ? Number(take) : undefined,
        });
    }

    @Roles(Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF
    )
    @Post('adjust')
    adjustStock(@Body() dto: AdjustStockDto, @CurrentUser() user: AuthUser){
        return this.stockService.adjustStock(dto, user);
    }

    @Get('settings')
    getSettings() {
        return this.stockService.getSettings();
    }

    @Roles(Role.BOSS, Role.ADMIN)
    @Patch('settings')
    updateSettings(@Body() dto: UpdateStockSettingsDto) {
        return this.stockService.updateSettings(dto);
    }

    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post('relocate')
    relocateStock(@Body() dto: RelocateStockDto, @CurrentUser() user: AuthUser) {
        return this.stockService.relocateStock(dto, user);
    }

    @Get('reports')
    findReports(
        @CurrentUser() user: AuthUser,
        @Query('status', new ParseEnumPipe(StockReportStatus, { optional: true })) status?: StockReportStatus,
        @Query('locationId') locationId?: string,
    ) {
        return this.stockService.findReports(user, { status, locationId: locationId?.trim() || undefined });
    }

    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post('reports')
    createReport(@Body() dto: CreateStockReportDto, @CurrentUser() user: AuthUser) {
        return this.stockService.createReport(dto, user);
    }

    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
    )
    @Post('reports/:id/resolve')
    resolveReport(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: ResolveStockReportDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.stockService.resolveReport(id, dto, user);
    }
}