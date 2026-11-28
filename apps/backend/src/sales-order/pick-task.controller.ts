import {
    Body,
    Controller,
    Get,
    Param,
    ParseEnumPipe,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PickTaskStatus, Role } from '../generated/prisma/enums';
import {
    ClaimPickTaskDto,
    ClaimPickTasksDto,
    UpdatePickTaskToteDto,
} from './dto/claim-pick-tasks.dto';
import { DropoffPickTaskDto } from './dto/dropoff-pick-task.dto';
import { PickItemDto } from './dto/pick-item.dto';
import { ReportPickShortageDto } from './dto/report-pick-shortage.dto';
import { PickTaskService } from './pick-task.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pick-tasks')
export class PickTaskController {
    constructor(private readonly pickTaskService: PickTaskService) {}

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
        Role.ORDER_CLERK,
    )
    @Get()
    findAll(
        @CurrentUser() user: AuthUser,
        @Query('sourceLocationId') sourceLocationId?: string,
        @Query('zoneId') zoneId?: string,
        @Query('status', new ParseEnumPipe(PickTaskStatus, { optional: true }))
        status?: PickTaskStatus,
        @Query('assignedToMe') assignedToMe?: string,
        @Query('salesOrderId') salesOrderId?: string,
        @Query('search') search?: string,
        @Query('skip') skip?: string,
        @Query('take') take?: string,
    ) {
        return this.pickTaskService.findAll(user, {
            sourceLocationId: sourceLocationId?.trim() || undefined,
            zoneId: zoneId?.trim() || undefined,
            status,
            assignedToMe: assignedToMe === 'true' || assignedToMe === '1',
            salesOrderId: salesOrderId?.trim() || undefined,
            search: search?.trim() || undefined,
            skip: skip !== undefined && skip !== '' ? Number(skip) : undefined,
            take: take !== undefined && take !== '' ? Number(take) : undefined,
        });
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Get('my-route')
    getMyRoute(
        @CurrentUser() user: AuthUser,
        @Query('sourceLocationId') sourceLocationId?: string,
    ) {
        return this.pickTaskService.getMyRoute(user, sourceLocationId?.trim() || undefined);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
        Role.ORDER_CLERK,
    )
    @Get(':id')
    findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.pickTaskService.findOne(id, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post('claim-batch')
    claimBatch(@Body() dto: ClaimPickTasksDto, @CurrentUser() user: AuthUser) {
        return this.pickTaskService.claimBatch(dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/claim')
    claim(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: ClaimPickTaskDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.pickTaskService.claim(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/release')
    release(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
        return this.pickTaskService.release(id, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Patch(':id/tote')
    updateTote(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdatePickTaskToteDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.pickTaskService.updateTote(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/pick')
    pick(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: PickItemDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.pickTaskService.pick(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/dropoff')
    dropoff(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: DropoffPickTaskDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.pickTaskService.dropoff(id, dto, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/pick/:movementId/undo')
    undoPick(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('movementId', ParseUUIDPipe) movementId: string,
        @CurrentUser() user: AuthUser,
    ) {
        return this.pickTaskService.undoPick(id, movementId, user);
    }

    @Roles(
        Role.BOSS,
        Role.ADMIN,
        Role.WAREHOUSE_MANAGER,
        Role.STORE_MANAGER,
        Role.WAREHOUSE_STAFF,
        Role.STORE_STAFF,
    )
    @Post(':id/report-shortage')
    reportShortage(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: ReportPickShortageDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.pickTaskService.reportShortage(id, dto, user);
    }
}
