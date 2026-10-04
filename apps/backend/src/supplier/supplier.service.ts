import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BaseService } from "../common/base.service";


@Injectable()
export class SupplierService extends BaseService<PrismaService['supplier']> {
  constructor(prisma: PrismaService) {
    super(prisma.supplier);
  }
}