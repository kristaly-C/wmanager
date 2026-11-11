import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ProductService } from "./product.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductController {
    constructor(private productService: ProductService) {}


    @Get()
    findAll(
        @Query('search') search?: string,
        @Query('categoryId') categoryId?: string,
        @Query('brandId') brandId?: string,
        @Query('skip') skip?: string,
        @Query('take') take?: string,
    ) {
        return this.productService.findAllFiltered({
            search,
            categoryId,
            brandId,
            skip: skip !== undefined ? Number(skip) : undefined,
            take: take !== undefined ? Number(take) : undefined,
        });
    }

    @Roles(Role.ADMIN,Role.BOSS,Role.WAREHOUSE_MANAGER)
    @Post()
    create(@Body() createProductDto: CreateProductDto) {
        return this.productService.create(createProductDto);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.productService.findOne(id);
    }
    @Roles(Role.ADMIN,Role.BOSS,Role.WAREHOUSE_MANAGER)
    @Patch(':id')
    update(@Param('id') id: string, @Body() UpdateProductDto: UpdateProductDto) {
        return this.productService.update(id, UpdateProductDto);
    }
    @Roles(Role.ADMIN,Role.BOSS,Role.WAREHOUSE_MANAGER)
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.productService.remove(id);
    }
}