import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { BaseService } from "../common/base.service";


@Injectable()
export class CategoryService extends BaseService<PrismaService['category']> {
    constructor(private prisma: PrismaService) {
        super(prisma.category);
    }

    private async assertValidParent(parentId: string, currentId?: string) {
        if (currentId && parentId === currentId) {
            throw new BadRequestException('A kategória nem lehet saját maga szülője');
        }

        const parent = await this.prisma.category.findUnique({
            where: { id: parentId },
            select: { id: true, parentId: true },
        });

        if (!parent) {
            throw new BadRequestException('A megadott szülő kategória nem létezik');
        }

        if (!currentId) {
            return;
        }

        const visited = new Set<string>([currentId, parent.id]);
        let cursorParentId = parent.parentId;

        while (cursorParentId) {
            if (cursorParentId === currentId) {
                throw new BadRequestException('Körkörös kategória-hierarchia nem megengedett');
            }
            if (visited.has(cursorParentId)) {
                break;
            }
            visited.add(cursorParentId);

            const ancestor = await this.prisma.category.findUnique({
                where: { id: cursorParentId },
                select: { parentId: true },
            });
            cursorParentId = ancestor?.parentId ?? null;
        }
    }

    async create(data: CreateCategoryDto) {
        if (data.parentId) {
            await this.assertValidParent(data.parentId);
        }
        return super.create(data);
    }

    async update(id: string, data: UpdateCategoryDto) {
        await this.findOne(id);
        if (data.parentId) {
            await this.assertValidParent(data.parentId, id);
        }
        return this.prisma.category.update({ where: { id }, data });
    }

    async remove(id: string) {
        await this.findOne(id);

        const childCount = await this.prisma.category.count({ where: { parentId: id } });
        if (childCount > 0) {
            throw new ConflictException('Nem törölhető olyan kategória, amelynek még vannak alkategóriái');
        }

        const productCount = await this.prisma.product.count({ where: { categoryId: id } });
        if (productCount > 0) {
            throw new ConflictException('Cannot delete a category that still has products');
        }
        return this.prisma.category.delete({ where: { id } });
    }
}
