import { ConflictException, Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import {
    buildVariantBarcodeOrClauses,
    buildVariantSkuOrClauses,
    buildVariantSupplierSkuOrClauses,
} from "../common/barcode-search";
import { PrismaService } from "../prisma/prisma.service";

export interface FindProductsOptions {
    search?: string;
    categoryId?: string;
    brandId?: string;
    skip?: number;
    take?: number;
}

@Injectable()
export class ProductService extends BaseService<PrismaService['product']> {
    constructor(private prisma: PrismaService) {
        super(prisma.product);
    }

    private async getCategorySubtreeIds(rootCategoryId: string): Promise<string[]> {
        const allCategories = await this.prisma.category.findMany({
            select: { id: true, parentId: true },
        });
        const childrenByParent = new Map<string, string[]>();
        for (const cat of allCategories) {
            if (!cat.parentId) continue;
            const list = childrenByParent.get(cat.parentId);
            if (list) {
                list.push(cat.id);
            } else {
                childrenByParent.set(cat.parentId, [cat.id]);
            }
        }

        const result: string[] = [];
        const queue: string[] = [rootCategoryId];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            result.push(currentId);
            const children = childrenByParent.get(currentId) ?? [];
            for (const childId of children) {
                if (!visited.has(childId)) {
                    queue.push(childId);
                }
            }
        }

        return result;
    }

    async findAllFiltered(options?: FindProductsOptions) {
        const q = options?.search?.trim();
        const categoryIds = options?.categoryId
            ? await this.getCategorySubtreeIds(options.categoryId)
            : undefined;

        const where = {
            ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
            ...(options?.brandId ? { brandId: options.brandId } : {}),
            ...(q
                ? {
                      OR: [
                          { name: { contains: q, mode: 'insensitive' as const } },
                          { manufacturerCode: { contains: q, mode: 'insensitive' as const } },
                          { model: { contains: q, mode: 'insensitive' as const } },
                          { brand: { name: { contains: q, mode: 'insensitive' as const } } },
                          { category: { name: { contains: q, mode: 'insensitive' as const } } },
                          {
                              variants: {
                                  some: {
                                      OR: [
                                          ...buildVariantSkuOrClauses(q),
                                          ...buildVariantBarcodeOrClauses(q),
                                          ...buildVariantSupplierSkuOrClauses(q),
                                      ],
                                  },
                              },
                          },
                      ],
                  }
                : {}),
        };

        const [items, total] = await this.prisma.$transaction([
            this.prisma.product.findMany({
                where,
                include: {
                    brand: { select: { id: true, name: true } },
                    category: { select: { id: true, name: true } },
                    primarySupplier: { select: { id: true, name: true } },
                    _count: { select: { variants: true } },
                },
                ...(options?.skip !== undefined ? { skip: options.skip } : {}),
                ...(options?.take !== undefined ? { take: options.take } : {}),
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.product.count({ where }),
        ]);

        return { items, total };
    }

    async remove(id: string) {
        await this.findOne(id);
        const variantCount = await this.prisma.variant.count({ where: { productId: id } });
        if (variantCount > 0) {
            throw new ConflictException('Nem törölhető olyan termék, amelyhez még tartoznak variánsok');
        }
        return this.prisma.product.delete({ where: { id } });
    }
}