import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { StocktakeService } from "./stocktake.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthUser, CurrentUser } from "../auth/decorators/current-user.decorator";
import { Role, StocktakeStatus } from "../generated/prisma/enums";
import { Roles } from "../auth/decorators/roles.decorator";
import { RecordStocktakeItemDto } from "./dto/record-stocktake-item.dto";
import { CreateStocktakeDto } from "./dto/create-stocktake.dto";
import { SubmitStocktakeDto } from "./dto/submit-stocktake.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stocktakes')
export class StocktakeController {
    constructor(private readonly stocktakeService: StocktakeService) {}

    @Get()
    findAll(
        @CurrentUser() user: AuthUser,
        @Query('locationId') locationId?: string,
        @Query('status') status?: StocktakeStatus,
    ) {
        return this.stocktakeService.findAll(user, locationId, status);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
        return this.stocktakeService.findOne(id, user);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER)
    @Get(':id/discrepancies')
    getDiscrepancies(@Param('id') id: string, @CurrentUser() user: AuthUser) {
        return this.stocktakeService.getDiscrepancies(id, user);
    }

    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post()
    startSession(@Body() dto: CreateStocktakeDto, @CurrentUser() user: AuthUser) {
        return this.stocktakeService.startSession(dto, user);
    }

    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/claim')
    claimSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
        return this.stocktakeService.claimSession(id, user);
    }

    /**
     * Időszakos piszkozat-mentés (Auto-sync tömbbel)
     */
    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Put(':id/items')
    syncItems(
        @Param('id') id: string,
        @Body() dto: SubmitStocktakeDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.stocktakeService.syncItems(id, dto, user);
    }

    /**
     * Egyetlen tétel módosítása (opcionális)
     */
    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Patch(':id/items')
    recordItem(
        @Param('id') id: string,
        @Body() dto: RecordStocktakeItemDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.stocktakeService.recordItem(id, dto, user);
    }

    /**
     * Leltár végleges beküldése jóváhagyásra (tömbbel vagy anélkül)
     */
    @Roles(
        Role.ADMIN,
        Role.BOSS,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/submit')
    submitForApproval(
        @Param('id') id: string,
        @Body() dto: SubmitStocktakeDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.stocktakeService.submitForApproval(id, dto, user);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER)
    @Post(':id/approve')
    approveSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
        return this.stocktakeService.approveSession(id, user);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER)
    @Post(':id/cancel')
    cancelSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
        return this.stocktakeService.cancelSession(id, user);
    }
}
