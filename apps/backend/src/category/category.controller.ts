import { Body, Controller, Delete, Get, Param, Patch, Post} from '@nestjs/common'
import { CategoryService} from './category.service'
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
export class CategoryController {
    constructor(private categoryService: CategoryService) {}

    @Get()
    findAll() {
        return this.categoryService.findAll();
    }

    @Post()
    create(@Body() CreateCategoryDto: CreateCategoryDto) {
        return this.categoryService.create(CreateCategoryDto);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.categoryService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() UpdateCategoryDto: UpdateCategoryDto) {
        return this.categoryService.update(id, UpdateCategoryDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.categoryService.remove(id);
    }
}