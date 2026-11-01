import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { BrandService } from "./brand.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CreateBrandDto } from "./dto/create-brand.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";
import { UpdateBrandDto } from "./dto/update-brand.dto";


@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('brand')
export class BrandController {
    constructor(private brandService: BrandService) {}

    @Get()
    findAll(){
        return this.brandService.findAll();
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Post()
    create(@Body() createBrandDto: CreateBrandDto) {
        return this.brandService.create(createBrandDto);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.brandService.findOne(id);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateBrandDto: UpdateBrandDto){
        return this.brandService.update(id, updateBrandDto);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Delete(':id')
    remove(@Param('id') id: string){
        return this.brandService.remove(id);
    }
}