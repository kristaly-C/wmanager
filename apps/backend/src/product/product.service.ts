import { ConflictException, Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
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

    async findAllFiltered(options?: FindProductsOptions) {
        const q = options?.search?.trim();
        const where = {
            ...(options?.categoryId ? { categoryId: options.categoryId } : {}),
            ...(options?.brandId ? { brandId: options.brandId } : {}),
            ...(q
                ? {
                      OR: [
                          { name: { contains: q, mode: 'insensitive' as const } },
                          { manufacturerCode: { contains: q, mode: 'insensitive' as const } },
                          { model: { contains: q, mode: 'insensitive' as const } },
                          { brand: { name: { contains: q, mode: 'insensitive' as const } } },
                          {
                              variants: {
                                  some: {
                                      OR: [
                                          { sku: { contains: q, mode: 'insensitive' as const } },
                                          {
                                              variantBarcodes: {
                                                  some: {
                                                      barcode: {
                                                          contains: q,
                                                          mode: 'insensitive' as const,
                                                      },
                                                  },
                                              },
                                          },
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