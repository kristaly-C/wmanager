import { Body, Controller,Get, Post, Query, UseGuards } from "@nestjs/common";
import { StockService } from "./stock.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthUser, CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";
import { AdjustStockDto } from "./dto/adjust-stock.dto";


@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock')
export class StockController{
    constructor(private readonly stockService: StockService){}


    @Get()
    findAll(
        @CurrentUser() user: AuthUser,
        @Query('locationId') locationId?: string,
        @Query('variantId') variantId?: string
    ){
        return this.stockService.findAll(user, locationId, variantId);
    }

    @Get('movements')
    findMovements(
        @CurrentUser() user: AuthUser,
        @Query('locationId') locationId?: string,
        @Query('variantId') variantId?: string
    ){
        return this.stockService.findMovements(user, locationId, variantId);
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
}