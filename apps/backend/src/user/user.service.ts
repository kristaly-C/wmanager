import { ConflictException, Delete, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BaseService } from '../common/base.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserModel } from '../generated/prisma/models';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../generated/prisma/enums';
import { Roles } from '../auth/decorators/roles.decorator';

@Injectable()
export class UserService extends BaseService<PrismaService['user']> {
  constructor(private prisma: PrismaService) {
    super(prisma.user);
  }

  async createUser(data: CreateUserDto, actor: AuthUser) {
    this.asserCanManage(actor, data.role)
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

  async removeUser(id: string, actor: AuthUser) {
    const pickedUser = await this.findOne(id);
    this.asserCanManage(actor, pickedUser.role);
    if(pickedUser.role === 'ADMIN'){
      const numberOfAdmins = await this.prisma.user.count({where: {role: 'ADMIN'}});
      if(numberOfAdmins < 2){
        throw new ConflictException('Cannot delete the last ADMIN user');
      }
    }
    if(pickedUser.role === 'BOSS'){
      throw new ConflictException('Cannot delete the BOSS');
    }
    const removed = await super.remove(id);
    return this.excludePassword(removed);
  }


  async updateUser(id:string, data: UpdateUserDto){
    const updated = await super.update(id, data);
    return this.excludePassword(updated);
  }

  private excludePassword(user: { passwordHash: string; [key: string]: any}) {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  private asserCanManage(actor: AuthUser, targetRole: Role){
    const protectedRoles: Role[] = [Role.ADMIN, Role.BOSS];
    if (protectedRoles.includes(targetRole) && actor.role !== Role.BOSS) {
      throw new ForbiddenException('Only a BOSS can manage ADMIN and BOSS accounts');
    }
  }
}