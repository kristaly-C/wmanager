import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { VariantService } from "./variant.service";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";



@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('variants')
export class VariantController {
    constructor(private variantService: VariantService) {}

    @Get()
    findAll() {
        return this.variantService.findAll();
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Post()
    create(@Body() createVariantDto: CreateVariantDto){
        return this.variantService.create(createVariantDto);
    }

    @Get(':id')
    findOne(@Param('id') id: string){
        return this.variantService.findOne(id);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateVariantDto: UpdateVariantDto) {
        return this.variantService.update(id, updateVariantDto);
    }

    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.variantService.remove(id);
    }
}