import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { VariantService } from "./variant.service";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";




@Controller()
export class VariantController {
    constructor(private variantService: VariantService) {}

    @Get()
    findAll() {
        return this.variantService.findAll();
    }

    @Post()
    create(@Body() createVariantDto: CreateVariantDto){
        return this.variantService.create(createVariantDto);
    }

    @Get(':id')
    findOne(@Param('id') id: string){
        return this.variantService.findOne(id);
    }


    @Patch(':id')
    update(@Param('id') id: string, @Body() updateVariantDto: UpdateVariantDto) {
        return this.variantService.update(id, updateVariantDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.variantService.remove(id);
    }
}