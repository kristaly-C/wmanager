import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";


@Injectable()
export class CategoryService {
    constructor(private prisma: PrismaService) {}

    findAll() {
        return this.prisma.category.findMany();
    }

    create(data: CreateCategoryDto) {
        return this.prisma.category.create({data});
    }

    findOne(id: string) {
        return this.prisma.category.findUnique({ where: {id}});
    }

    update(id: string, data: UpdateCategoryDto) {
        return this.prisma.category.update( { where: {id}, data});
    }
    remove(id: string) {
        return this.prisma.category.delete( {where: {id}});
    }
}