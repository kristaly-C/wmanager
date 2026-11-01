import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { LocationService } from "./location.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateLocationDto } from "./dto/create-location.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { RolesGuard } from "../auth/guards/roles.guard";


@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('locations')
export class LocationController {
    constructor(private readonly locationService: LocationService) {}


    @Get()
    findAll() {
        return this.locationService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.locationService.findOne(id);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Post()
    create(@Body() data: CreateLocationDto ) {
        return this.locationService.createLocation(data)
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER )
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateLocation: UpdateLocationDto) {
        return this.locationService.update(id, updateLocation);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER )
    @Delete(':id')
    remove(@Param('id') id: string){
        return this.locationService.remove(id);
    }
}