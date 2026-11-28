import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { LocationService } from "./location.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateLocationDto } from "./dto/create-location.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { LocationType, Role } from "../generated/prisma/enums";
import { LocationModel } from "../generated/prisma/models";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { RolesGuard } from "../auth/guards/roles.guard";
import { LocationAccessService } from "./location-access.service";
import { AuthUser, CurrentUser } from "../auth/decorators/current-user.decorator";
import { LOCATION_UNBOUND_ROLES } from "../common/location-scope";
import { BulkCreateLocationsDto } from "./dto/bulk-create-locations.dto";


@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('locations')
export class LocationController {
    constructor(private readonly locationService: LocationService, 
                private readonly locationAccessService: LocationAccessService
    ) {}


    @Get()
    async findAll(@CurrentUser() user: AuthUser) {
        const scope = await this.locationAccessService.getScopeContext(user);
        if (scope.isUnbound) {
            const locations = await this.locationService.findAll({ orderBy: { name: 'asc' } });
            return locations.map((loc: LocationModel) => ({ ...loc, isAssigned: true }));
        }

        const accessibleIdList = Array.from(scope.accessibleIds);
        const where = {
            OR: [
                ...(accessibleIdList.length > 0 ? [{ id: { in: accessibleIdList } }] : []),
                { type: { in: [LocationType.WAREHOUSE, LocationType.STORE] } },
            ],
        };
        const locations = await this.locationService.findAll({ where, orderBy: { name: 'asc' } });
        return locations.map((loc: LocationModel) => ({
            ...loc,
            isAssigned: scope.isAssigned(loc.id),
        }));
    }

    @Get(':id')
    async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
        const location = await this.locationService.findOne(id);
        const canAccess = await this.locationAccessService.canAccess(user, id);
        if (!canAccess && location.type !== LocationType.WAREHOUSE && location.type !== LocationType.STORE) {
            throw new ForbiddenException('Ehhez a helyhez nincs hozzáférésed');
        }
        return { ...location, isAssigned: canAccess };
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER)
    @Post()
    async create(@Body() data: CreateLocationDto, @CurrentUser() user: AuthUser ) {
        if(data.parentId){
            await this.locationAccessService.assertCanAccess(user, data.parentId);
        }else if (!LOCATION_UNBOUND_ROLES.includes(user.role)){
            throw new ForbiddenException('Új raktárat vagy üzletet csak adminisztrátor vagy vezető hozhat létre');
        }
        
        return this.locationService.createLocation(data)
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER)
    @Post('bulk')
    async bulkCreate(@Body() data: BulkCreateLocationsDto, @CurrentUser() user: AuthUser) {
        await this.locationAccessService.assertCanAccess(user, data.parentId);
        return this.locationService.bulkCreateLocations(data);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER )
    @Patch(':id')
    async update(@Param('id') id: string,
                 @Body() updateLocation: UpdateLocationDto,
                 @CurrentUser() user: AuthUser) 
    {
        if (
            (updateLocation.canFulfillWebshop !== undefined ||
                updateLocation.fulfillmentPriority !== undefined ||
                updateLocation.dispatchHubLocationId !== undefined) &&
            user.role !== Role.ADMIN &&
            user.role !== Role.BOSS
        ) {
            throw new ForbiddenException(
                'A webshop teljesítési és közös kiszállítási központ beállításokat csak ADMIN vagy BOSS módosíthatja',
            );
        }

        await this.locationAccessService.assertCanAccess(user, id);

        if( updateLocation.parentId){
            await this.locationAccessService.assertCanAccess( user, updateLocation.parentId);
        }
        return this.locationService.update(id, updateLocation);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER )
    @Delete(':id')
    async remove(@Param('id') id: string,
                 @CurrentUser() user: AuthUser,
                )
    {
        await this.locationAccessService.assertCanAccess(user, id);
        return this.locationService.remove(id);
    }
}
