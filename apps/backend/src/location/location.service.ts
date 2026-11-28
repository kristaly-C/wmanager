import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";
import { LocationType, SlotMode } from "../generated/prisma/enums";
import { CreateLocationDto } from "./dto/create-location.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { BulkCreateLocationsDto, BulkLocationItemDto } from "./dto/bulk-create-locations.dto";

const MAX_BULK_LOCATIONS = 500;



@Injectable()
export class LocationService extends BaseService<PrismaService['location']> {
    constructor(private prisma: PrismaService){
        super(prisma.location);
    }

    private readonly allowedParents: Record<LocationType, LocationType[]> = {
        WAREHOUSE: [],
        STORE: [],
        ZONE: ['WAREHOUSE', 'STORE'],
        SHELF: ['ZONE'],
        BIN: ['SHELF']
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


    private assertValidSlotMode(type: LocationType, slotMode?: SlotMode | null) {
        const hasSlotMode = slotMode !== undefined && slotMode !== null;
        if((type === 'WAREHOUSE' || type === 'STORE') && hasSlotMode) {
            throw new BadRequestException('A slotMode csak ZONE, SHELF és BIN típusnál adható meg');
        }
    }

    private assertValidFulfillmentFields(
        type: LocationType,
        canFulfillWebshop?: boolean,
        fulfillmentPriority?: number,
    ) {
        if (
            type !== LocationType.WAREHOUSE &&
            type !== LocationType.STORE &&
            (canFulfillWebshop !== undefined || fulfillmentPriority !== undefined)
        ) {
            throw new BadRequestException(
                'A canFulfillWebshop és fulfillmentPriority csak WAREHOUSE és STORE telephelyeken állítható',
            );
        }
    }

    private assertValidDropoffFlag(type: LocationType, isDropoffLocation?: boolean) {
        if (
            isDropoffLocation === true &&
            (type === LocationType.WAREHOUSE || type === LocationType.STORE)
        ) {
            throw new BadRequestException(
                'A lerakóhely (isDropoffLocation) jelölés csak ZONE, SHELF vagy BIN pozíción engedélyezett',
            );
        }
    }

    private async assertValidDispatchHub(
        type: LocationType,
        currentId: string | null,
        dispatchHubLocationId?: string | null,
    ) {
        if (dispatchHubLocationId === undefined || dispatchHubLocationId === null) {
            return;
        }

        if (type !== LocationType.WAREHOUSE && type !== LocationType.STORE) {
            throw new BadRequestException(
                'A közös kiszállítási központ (dispatchHubLocationId) csak WAREHOUSE vagy STORE telephelyen állítható',
            );
        }

        if (currentId && dispatchHubLocationId === currentId) {
            throw new BadRequestException(
                'Egy telephely nem lehet saját maga kiszállítási központja',
            );
        }

        const hub = await this.prisma.location.findUnique({
            where: { id: dispatchHubLocationId },
            select: {
                id: true,
                type: true,
                isActive: true,
                dispatchHubLocationId: true,
            },
        });
        if (
            !hub ||
            !hub.isActive ||
            (hub.type !== LocationType.WAREHOUSE && hub.type !== LocationType.STORE)
        ) {
            throw new BadRequestException(
                'A választott közös kiszállítási központ nem aktív raktár vagy üzlet',
            );
        }

        if (hub.dispatchHubLocationId !== null) {
            throw new BadRequestException(
                'A választott központ már egy másik központhoz tartozik (maximum 1 szintű összekapcsolás engedélyezett)',
            );
        }

        if (currentId) {
            const linkedCount = await this.prisma.location.count({
                where: { dispatchHubLocationId: currentId },
            });
            if (linkedCount > 0) {
                throw new BadRequestException(
                    'Ehhez a telephelyhez már tartoznak kapcsolt épületek, ezért nem rendelhető másik központ alá',
                );
            }
        }
    }

    async createLocation(data: CreateLocationDto) {
        await this.assertValidPlacement(data.type, data.parentId);
        this.assertValidSlotMode(data.type, data.slotMode);
        this.assertValidFulfillmentFields(
            data.type,
            data.canFulfillWebshop,
            data.fulfillmentPriority,
        );
        this.assertValidDropoffFlag(data.type, data.isDropoffLocation);
        await this.assertValidDispatchHub(data.type, null, data.dispatchHubLocationId);

        const defaultPriority = data.type === LocationType.WAREHOUSE ? 10 : 100;
        return super.create({
            name: data.name,
            description: data.description,
            type: data.type,
            slotMode: data.slotMode,
            isActive: data.isActive,
            parentId: data.parentId ?? null,
            canFulfillWebshop: data.canFulfillWebshop ?? true,
            fulfillmentPriority: data.fulfillmentPriority ?? defaultPriority,
            dispatchHubLocationId: data.dispatchHubLocationId ?? null,
            isDropoffLocation: data.isDropoffLocation ?? false,
        });
    }

    async update(id: string, data: UpdateLocationDto) {
        const current = await this.findOne(id);
    
        if (data.parentId !== undefined) {
            if (data.parentId === id) {
                throw new BadRequestException('A lokáció nem lehet saját maga szülője');
            }
            await this.assertValidPlacement(current.type, data.parentId);
        }
        if (data.slotMode !== undefined) {
            this.assertValidSlotMode(current.type, data.slotMode);
        }
        if (data.canFulfillWebshop !== undefined || data.fulfillmentPriority !== undefined) {
            this.assertValidFulfillmentFields(
                current.type,
                data.canFulfillWebshop,
                data.fulfillmentPriority,
            );
        }
        if (data.isDropoffLocation !== undefined) {
            this.assertValidDropoffFlag(current.type, data.isDropoffLocation);
        }
        if (data.dispatchHubLocationId !== undefined) {
            await this.assertValidDispatchHub(
                current.type,
                id,
                data.dispatchHubLocationId,
            );
        }
    
        return this.prisma.location.update({ where: { id }, data });
    }

    async remove(id: string) {
        await this.findOne(id);

        const childCount = await this.prisma.location.count({
            where: { parentId: id},
        });
        if(childCount > 0){
            throw new ConflictException('Nem törölhető olyan lokáció, amelynek még vannak al-lokációi');
        }
        const stockCount = await this.prisma.stockItem.count({
            where: { locationId: id, quantity: {gt: 0}},
        });
        if( stockCount > 0){
            throw new ConflictException('Nem törölhető olyan lokáció, amelyen még van készlet');
        }

        return this.prisma.location.delete({ where: { id}});
    }

    private resolveBulkNodes(dto: BulkCreateLocationsDto): BulkLocationItemDto[] {
        const hasItems = Array.isArray(dto.items) && dto.items.length > 0;
        const hasSequenceFields = dto.start !== undefined || dto.end !== undefined || dto.type !== undefined;

        if (hasItems && hasSequenceFields) {
            throw new BadRequestException('Vagy az items listát, vagy a sorozat paramétereket (type, start, end) add meg, ne mindkettőt');
        }

        if (hasItems) {
            return dto.items!;
        }

        if (dto.type === undefined || dto.start === undefined || dto.end === undefined) {
            throw new BadRequestException('Add meg a generálandó pozíciók típusát és tartományát (start, end)');
        }

        if (dto.start > dto.end) {
            throw new BadRequestException('A kezdő sorszám nem lehet nagyobb a záró sorszámnál');
        }

        const count = dto.end - dto.start + 1;
        if (count > MAX_BULK_LOCATIONS) {
            throw new BadRequestException(`Egyszerre legfeljebb ${MAX_BULK_LOCATIONS} pozíció hozható létre`);
        }

        const prefix = dto.prefix ?? '';
        const suffix = dto.suffix ?? '';
        const padLength = dto.padLength ?? 0;

        const nodes: BulkLocationItemDto[] = [];
        for (let i = dto.start; i <= dto.end; i++) {
            const num = padLength > 0 ? String(i).padStart(padLength, '0') : String(i);
            const name = `${prefix}${num}${suffix}`.trim();
            if (!name) {
                throw new BadRequestException('A generált pozíciónév nem lehet üres');
            }
            nodes.push({
                name,
                description: dto.description,
                type: dto.type,
                slotMode: dto.slotMode,
                isActive: dto.isActive,
            });
        }
        return nodes;
    }

    private countAndValidateTree(nodes: BulkLocationItemDto[], parentType: LocationType): number {
        let total = 0;
        for (const node of nodes) {
            const trimmedName = node.name.trim();
            if (!trimmedName) {
                throw new BadRequestException('A pozíció neve nem lehet üres');
            }
            const allowed = this.allowedParents[node.type];
            if (!allowed.includes(parentType)) {
                throw new BadRequestException(`A ${node.type} nem lehet ${parentType} alatt`);
            }
            this.assertValidSlotMode(node.type, node.slotMode);
            total += 1;
            if (node.children?.length) {
                total += this.countAndValidateTree(node.children, node.type);
            }
        }
        return total;
    }

    async bulkCreateLocations(dto: BulkCreateLocationsDto) {
        const parent = await this.prisma.location.findUnique({ where: { id: dto.parentId } });
        if (!parent) {
            throw new BadRequestException('A megadott szülő lokáció nem létezik');
        }

        const rootNodes = this.resolveBulkNodes(dto);
        const totalNodes = this.countAndValidateTree(rootNodes, parent.type);
        if (totalNodes === 0) {
            throw new BadRequestException('Legalább egy pozíciót meg kell adni');
        }
        if (totalNodes > MAX_BULK_LOCATIONS) {
            throw new BadRequestException(`Egyszerre legfeljebb ${MAX_BULK_LOCATIONS} pozíció hozható létre`);
        }

        const skipDuplicates = dto.skipDuplicates ?? true;
        const created: Awaited<ReturnType<PrismaService['location']['create']>>[] = [];
        const skippedNames: string[] = [];

        await this.prisma.$transaction(async (tx) => {
            const insertLevel = async (nodes: BulkLocationItemDto[], parentId: string) => {
                const existingChildren = await tx.location.findMany({
                    where: { parentId },
                    select: { id: true, name: true, type: true },
                });
                const existingByName = new Map(
                    existingChildren.map((child) => [child.name.trim().toLowerCase(), child]),
                );

                for (const node of nodes) {
                    const trimmedName = node.name.trim();
                    const key = trimmedName.toLowerCase();
                    const existing = existingByName.get(key);

                    let targetParentId: string;
                    if (existing) {
                        if (!skipDuplicates) {
                            throw new ConflictException(`Már létezik "${trimmedName}" nevű pozíció ezen a szülőn belül`);
                        }
                        skippedNames.push(trimmedName);
                        if (node.children?.length && existing.type !== node.type) {
                            throw new ConflictException(
                                `A meglévő "${trimmedName}" lokáció típusa (${existing.type}) eltér a várt típustól (${node.type})`,
                            );
                        }
                        targetParentId = existing.id;
                    } else {
                        const createdLoc = await tx.location.create({
                            data: {
                                name: trimmedName,
                                description: node.description?.trim() || undefined,
                                type: node.type,
                                slotMode: node.slotMode,
                                isActive: node.isActive ?? true,
                                parentId,
                            },
                        });
                        created.push(createdLoc);
                        existingByName.set(key, {
                            id: createdLoc.id,
                            name: createdLoc.name,
                            type: createdLoc.type,
                        });
                        targetParentId = createdLoc.id;
                    }

                    if (node.children?.length) {
                        await insertLevel(node.children, targetParentId);
                    }
                }
            };

            await insertLevel(rootNodes, parent.id);
        });

        return {
            createdCount: created.length,
            skippedCount: skippedNames.length,
            created,
            skippedNames,
        };
    }
}
