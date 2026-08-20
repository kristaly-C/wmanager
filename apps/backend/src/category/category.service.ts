import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto } from "./dto/create-category.dto";


@Injectable()
export class CategoryService {
    constructor(private prisma: PrismaService) {}

    findAll() {
        return this.prisma.category.findMany();
    }

    create(data: CreateCategoryDto) {
        return this.prisma.category.create({data});
    }
}