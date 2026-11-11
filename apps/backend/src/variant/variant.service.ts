import { Injectable, NotFoundException } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { VariantModel } from "../generated/prisma/models";
import { canSeeCostPrice, excludeCostPrice } from "../common/cost-price";

export interface FindVariantsOptions {
    search?: string;
    productId?: string;
    skip?: number;
    take?: number;
}

@Injectable()
export class VariantService extends BaseService<PrismaService['variant']> {
    constructor(private prisma: PrismaService) {
        super(prisma.variant);
    }

    async findAllForUser(user: AuthUser, options?: FindVariantsOptions) {
        const q = options?.search?.trim();
        const variants = await super.findAll({
            where: {
                ...(options?.productId ? { productId: options.productId } : {}),
                ...(q
                    ? {
                          OR: [
                              { sku: { contains: q, mode: 'insensitive' } },
                              {
                                  variantBarcodes: {
                                      some: { barcode: { contains: q, mode: 'insensitive' } },
                                  },
                              },
                              { product: { name: { contains: q, mode: 'insensitive' } } },
                              { product: { manufacturerCode: { contains: q, mode: 'insensitive' } } },
                              { product: { model: { contains: q, mode: 'insensitive' } } },
                          ],
                      }
                    : {}),
            },
            include: {
                variantBarcodes: {
                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                },
            },
            ...(options?.skip !== undefined ? { skip: options.skip } : {}),
            ...(options?.take !== undefined ? { take: options.take } : {}),
            orderBy: { createdAt: 'desc' },
        });
        if (canSeeCostPrice(user.role)) {
            return variants;
        }
        return variants.map((v: VariantModel) => excludeCostPrice(v));
    }

    async findOneForUser(id: string, user: AuthUser) {
        const variant = await this.prisma.variant.findUnique({
            where: { id },
            include: {
                variantBarcodes: {
                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                },
            },
        });

        if (!variant) {
            throw new NotFoundException(`Record with id ${id} not found`);
        }
        if (canSeeCostPrice(user.role)) {
            return variant;
        }
        return excludeCostPrice(variant);
    }
}
