import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { BaseService } from "../common/base.service";


@Injectable()
export class CategoryService extends BaseService<PrismaService['category']> {
    constructor(private prisma: PrismaService) {
        super(prisma.category);
    }

    async remove(id: string) {
        const productCount = await this.prisma.product.count({where: {categoryId: id} });
        if(productCount > 0) {
            throw new ConflictException('Cannot delete a category that still has products');
        }
        return super.remove(id);
    }
}