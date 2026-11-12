import { Injectable } from "@nestjs/common";
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

    findAllFiltered(options?: FindProductsOptions) {
        const q = options?.search?.trim();
        return super.findAll({
            where: {
                ...(options?.categoryId ? { categoryId: options.categoryId } : {}),
                ...(options?.brandId ? { brandId: options.brandId } : {}),
                ...(q
                    ? {
                          OR: [
                              { name: { contains: q, mode: 'insensitive' } },
                              { manufacturerCode: { contains: q, mode: 'insensitive' } },
                              { model: { contains: q, mode: 'insensitive' } },
                              { brand: { name: { contains: q, mode: 'insensitive' } } },
                              {
                                  variants: {
                                      some: {
                                          OR: [
                                              { sku: { contains: q, mode: 'insensitive' } },
                                              {
                                                  variantBarcodes: {
                                                      some: {
                                                          barcode: {
                                                              contains: q,
                                                              mode: 'insensitive',
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
            },
            ...(options?.skip !== undefined ? { skip: options.skip } : {}),
            ...(options?.take !== undefined ? { take: options.take } : {}),
            orderBy: { createdAt: 'desc' },
        });
    }
}