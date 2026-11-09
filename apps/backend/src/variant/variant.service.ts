import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { Role } from "../generated/prisma/enums";
import { VariantModel } from "../generated/prisma/models";

const COST_PRICE_ROLES: Role[] = [
    Role.BOSS,
    Role.ADMIN,
    Role.WAREHOUSE_MANAGER,
    Role.STORE_MANAGER,
    Role.ORDER_CLERK,
];

@Injectable()
export class VariantService extends BaseService<PrismaService['variant']> {
    constructor(private prisma: PrismaService) {
        super(prisma.variant);
    }

    async findAllForUser(user: AuthUser) {
        const variants = await super.findAll();
        if (COST_PRICE_ROLES.includes(user.role)) {
            return variants;
        }
        return variants.map((v: VariantModel) => this.excludeCostPrice(v));
    }

    async findOneForUser(id: string, user: AuthUser) {
        const variant = await super.findOne(id);
        if (COST_PRICE_ROLES.includes(user.role)) {
            return variant;
        }
        return this.excludeCostPrice(variant);
    }

    private excludeCostPrice<T extends { costPrice?: any }>(variant: T): Omit<T, 'costPrice'> {
        const { costPrice, ...rest } = variant;
        return rest;
    }
}
