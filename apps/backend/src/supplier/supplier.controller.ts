import { Body, Controller, Get, Post, Param, Patch, Delete, UseGuards} from "@nestjs/common";
import { SupplierService } from "./supplier.service";
import { CreateSupplierDto } from "./dto/create-supplier.dto";
import { UpdateSupplierDto } from "./dto/update-supplier.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('suppliers')
export class SupplierController {
    constructor(private supplierService: SupplierService) {}


    @Get()
    findAll() {
        return this.supplierService.findAll();
    }
    
    @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
    @Post()
    create(@Body() CreateSupplierDto: CreateSupplierDto) {
        return this.supplierService.create(CreateSupplierDto);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.supplierService.findOne(id);
    }


    @Roles(Role.ADMIN, Role.BOSS)
    @Patch(':id')
    update(@Param('id') id: string, @Body() UpdateSupplierDto: UpdateSupplierDto) {
        return this.supplierService.update(id, UpdateSupplierDto);
    }


    @Roles(Role.ADMIN, Role.BOSS)
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.supplierService.remove(id);
    }
}