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
                throw new BadRequestException('A WAREHOUSE nem lehet egy másik lokáció alatt');
            }
            return
        }
    }
    //itt járok most
    private assertValidSlotMode(type: LocationType, SlotMode?: SlotMode | null) {
        
        if((type === 'WAREHOUSE' || type === 'STORE') && SlotMode !== null) {

            throw new BadRequestException();
        }
    }

    async createLocation(data: CreateLocationDto){

    }

    async update(id: string, data: UpdateLocationDto){
        const current = await this.findOne(id);

    }
}