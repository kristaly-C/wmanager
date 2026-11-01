import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";


@Injectable()
export class BrandService extends BaseService<PrismaService['brand']> {
    constructor(prisma: PrismaService) {
        super(prisma.brand);
    }
}