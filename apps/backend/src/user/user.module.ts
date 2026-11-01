import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserLocationService } from './user-location.service';
import { UserLocationController } from './user-location.controller';

@Module({
    controllers: [UserController, UserLocationController],
    providers: [UserService, UserLocationService],
})
export class UserModule {}