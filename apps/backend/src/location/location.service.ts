import { BadRequestException, Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";
import { LocationType, SlotMode } from "../generated/prisma/enums";
import { CreateLocationDto } from "./dto/create-location.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";



@Injectable()
export class LocationService extends BaseService<PrismaService['location']> {
    constructor(private prisma: PrismaService){
        super(prisma.location);
    }

    private readonly allowedParents: Record<LocationType, LocationType[]> = {
        WAREHOUSE: [],
        STORE: [],
        ZONE: ['WAREHOUSE', 'STORE'],
        SHELF: ['ZONE']
    }

    private async assertValidPlacement(type: LocationType, parentId?: string | null) {
        const hasParent = parentId !== undefined && parentId !== null;
        const allowed = this.allowedParents[type];

        if(allowed.length === 0){
            if(hasParent){
                throw new BadRequestException(`A ${type} nem lehet egy másik lokáció alatt`);
            }
            return
        }

        if(!hasParent){
            throw new BadRequestException(`A ${type} tipusnak kötelező szülő`);
        }

        const parent = await this.prisma.location.findUnique({ where: { id: parentId } });
        if(!parent) {
            throw new BadRequestException('A megadott szülő lokáció nem létezik');
        }

        if(!allowed.includes(parent.type)){
            throw new BadRequestException(`A ${type} nem lehet ${parent.type} alatt`);
        }
    }


    private assertValidSlotMode(type: LocationType, SlotMode?: SlotMode | null) {
        const hasSlotMode = SlotMode !== undefined && SlotMode !== null;
        if((type === 'WAREHOUSE' || type === 'STORE') && hasSlotMode) {
            throw new BadRequestException('A slotMode csak ZONE és SHELF típusnál adható meg');
        }
    }

    async createLocation(data: CreateLocationDto) {
        await this.assertValidPlacement(data.type, data.parentId);
        this.assertValidSlotMode(data.type, data.slotMode);
        return super.create({
            name: data.name,
            description: data.description ?? '',
            type: data.type,
            slotMode: data.slotMode,
            isActive: data.isActive,
            parentId: data.parentId ?? null,
        });
    }

    async update(id: string, data: UpdateLocationDto) {
        const current = await this.findOne(id);
    
        if (data.parentId !== undefined) {
            await this.assertValidPlacement(current.type, data.parentId);
        }
        if (data.slotMode !== undefined) {
            this.assertValidSlotMode(current.type, data.slotMode);
        }
    
        return super.update(id, data);
    }
}