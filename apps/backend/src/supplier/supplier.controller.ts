import { Body, Controller, Get, Post, Param, Patch, Delete} from "@nestjs/common";
import { SupplierService } from "./supplier.service";
import { CreateSupplierDto } from "./dto/create-supplier.dto";
import { UpdateSupplierDto } from "./dto/update-supplier.dto";


@Controller('supplier')
export class SupplierController {
    constructor(private supplierService: SupplierService) {}


    @Get()
    findAll() {
        return this.supplierService.findAll();
    }

    @Post()
    create(@Body() CreateSupplierDto: CreateSupplierDto) {
        return this.supplierService.create(CreateSupplierDto);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.supplierService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() UpdateSupplierDto: UpdateSupplierDto) {
        return this.supplierService.update(id, UpdateSupplierDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.supplierService.remove(id);
    }
}