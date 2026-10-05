import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BaseService } from '../common/base.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserModel } from '../generated/prisma/models';

@Injectable()
export class UserService extends BaseService<PrismaService['user']> {
  constructor(private prisma: PrismaService) {
    super(prisma.user);
  }

  async createUser(data: CreateUserDto) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const { password, ...rest } = data;

    const user = await super.create({ ...rest, passwordHash });
    return this.excludePassword(user);
  
  }

  async findAll() {
    const users = await super.findAll();
    return users.map((u: UserModel) => this.excludePassword(u));
  }

  async findOne(id: string) {
    const user = await super.findOne(id);
    return this.excludePassword(user);
  }


  async remove(id: string) {
    const pickedUser = await this.findOne(id);
    if(pickedUser.role === 'ADMIN'){
      const numberOfAdmins = await this.prisma.user.count({where: {role: 'ADMIN'}});
      if(numberOfAdmins < 2){
        throw new ConflictException('Cannot delete the last ADMIN user');
      }
    }
    if(pickedUser.role === 'BOSS'){
      throw new ConflictException('Cannot delete the BOSS');
    }
    return super.remove(id);
  }

  private excludePassword(user: { passwordHash: string; [key: string]: any}) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}