import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";


@Injectable()
export class ProductService extends BaseService<PrismaService['product']> {
    constructor(private prisma: PrismaService) {
        super(prisma.product);
    }
}