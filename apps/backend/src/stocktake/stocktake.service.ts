import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LocationAccessService } from "../location/location-access.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { MovementType, Role, SlotMode, StocktakeStatus } from "../generated/prisma/enums";
import { CreateStocktakeDto } from "./dto/create-stocktake.dto";
import { RecordStocktakeItemDto } from "./dto/record-stocktake-item.dto";
import { SubmitStocktakeDto } from "./dto/submit-stocktake.dto";

const BLIND_STOCKTAKE_ROLES: Role[] = [Role.WAREHOUSE_STAFF, Role.STORE_STAFF];

@Injectable()
export class StocktakeService {
    constructor(
        private prisma: PrismaService,
        private locationAccessService: LocationAccessService,
    ) {}

    private isBlindRole(role: Role): boolean {
        return BLIND_STOCKTAKE_ROLES.includes(role);
    }

    private maskItemIfBlind<T extends { expectedQuantity?: any; discrepancy?: any }>(
        item: T,
        user: AuthUser,
    ) {
        if (!this.isBlindRole(user.role)) {
            return item;
        }
        const { expectedQuantity, discrepancy, ...rest } = item;
        return rest;
    }

    private maskSessionIfBlind<T extends { items?: any[] }>(session: T, user: AuthUser) {
        if (!this.isBlindRole(user.role) || !session.items) {
            return session;
        }
        return {
            ...session,
            items: session.items.map((item) => this.maskItemIfBlind(item, user)),
        };
    }

    async findAll(user: AuthUser, locationId?: string, status?: StocktakeStatus) {
        if (locationId) {
            await this.locationAccessService.assertCanAccess(user, locationId);
        }

        const locationWhere = await this.locationAccessService.accessibleWhere(user);

        return this.prisma.stocktakeSession.findMany({
            where: {
                ...(locationId ? { locationId } : { location: locationWhere }),
                ...(status ? { status } : {}),
            },
            include: {
                location: true,
                performedBy: { select: { id: true, name: true, email: true, role: true } },
                approvedBy: { select: { id: true, name: true, email: true, role: true } },
                _count: { select: { items: true } },
            },
            orderBy: { startedAt: 'desc' },
        });
    }

    async findOne(id: string, user: AuthUser) {
        const session = await this.prisma.stocktakeSession.findUnique({
            where: { id },
            include: {
                location: true,
                performedBy: { select: { id: true, name: true, email: true, role: true } },
                approvedBy: { select: { id: true, name: true, email: true, role: true } },
                items: {
                    include: {
                        variant: {
                            include: {
                                product: true,
                                variantBarcodes: {
                                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                                },
                            },
                        },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!session) {
            throw new NotFoundException('A leltár munkamenet nem található');
        }

        await this.locationAccessService.assertCanAccess(user, session.locationId);
        return this.maskSessionIfBlind(session, user);
    }

    async getDiscrepancies(id: string, user: AuthUser) {
        const session = await this.prisma.stocktakeSession.findUnique({
            where: { id },
            include: {
                location: true,
                performedBy: { select: { id: true, name: true, email: true, role: true } },
                approvedBy: { select: { id: true, name: true, email: true, role: true } },
                items: {
                    include: {
                        variant: {
                            include: {
                                product: true,
                                variantBarcodes: {
                                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!session) {
            throw new NotFoundException('A leltár munkamenet nem található');
        }

        await this.locationAccessService.assertCanAccess(user, session.locationId);

        const discrepancies = session.items.filter(
            (item) => item.discrepancy !== null && item.discrepancy !== 0,
        );

        return {
            sessionId: session.id,
            location: session.location,
            status: session.status,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            performedBy: session.performedBy,
            approvedBy: session.approvedBy,
            discrepancyCount: discrepancies.length,
            discrepancies,
        };
    }

    async startSession(dto: CreateStocktakeDto, user: AuthUser) {
        await this.locationAccessService.assertCanAccess(user, dto.locationId);

        const location = await this.prisma.location.findUnique({
            where: { id: dto.locationId },
        });
        if (!location) {
            throw new NotFoundException('A megadott lokáció nem található');
        }
        if (!location.isActive) {
            throw new BadRequestException('Inaktív lokáción nem indítható leltár');
        }

        // Ha splitByChildren = true (pl. egy Zónát részfeladatokra bontunk az alatta lévő aktív polcokra)
        if (dto.splitByChildren) {
            const children = await this.prisma.location.findMany({
                where: { parentId: dto.locationId, isActive: true },
                orderBy: { name: 'asc' },
            });

            if (children.length === 0) {
                throw new BadRequestException(
                    'A megadott lokációnak nincsenek aktív al-lokációi, így nem bontható részfeladatokra',
                );
            }

            const childIds = children.map((c) => c.id);
            const activeOnChildren = await this.prisma.stocktakeSession.findFirst({
                where: {
                    locationId: { in: childIds },
                    status: {
                        in: [StocktakeStatus.IN_PROGRESS, StocktakeStatus.WAITING_FOR_APPROVAL],
                    },
                },
                include: { location: true },
            });

            if (activeOnChildren) {
                throw new ConflictException(
                    `Az egyik al-lokáción (${activeOnChildren.location.name}) már van folyamatban lévő leltár`,
                );
            }

            return this.prisma.$transaction(async (tx) => {
                const createdSessions = [];

                for (const child of children) {
                    const currentStock = await tx.stockItem.findMany({
                        where: { locationId: child.id },
                    });

                    const session = await tx.stocktakeSession.create({
                        data: {
                            locationId: child.id,
                            // Részfeladatoknál alapból nyitott feladatok jönnek létre, hogy több raktáros felvehesse őket
                            performedByUserId: null,
                            note: dto.note ?? `${location.name} — ${child.name} részleltár`,
                            status: StocktakeStatus.IN_PROGRESS,
                            items: {
                                create: currentStock.map((s) => ({
                                    variantId: s.variantId,
                                    expectedQuantity: s.quantity,
                                })),
                            },
                        },
                        include: {
                            location: true,
                            _count: { select: { items: true } },
                        },
                    });

                    createdSessions.push(session);
                }

                return createdSessions;
            });
        }

        const activeSession = await this.prisma.stocktakeSession.findFirst({
            where: {
                locationId: dto.locationId,
                status: { in: [StocktakeStatus.IN_PROGRESS, StocktakeStatus.WAITING_FOR_APPROVAL] },
            },
        });
        if (activeSession) {
            throw new ConflictException(
                'Ezen a lokáción már van folyamatban lévő vagy jóváhagyásra váró leltár',
            );
        }

        const session = await this.prisma.$transaction(async (tx) => {
            const currentStock = await tx.stockItem.findMany({
                where: { locationId: dto.locationId },
            });

            return tx.stocktakeSession.create({
                data: {
                    locationId: dto.locationId,
                    performedByUserId: dto.isTask ? null : user.userId,
                    note: dto.note,
                    status: StocktakeStatus.IN_PROGRESS,
                    items: {
                        create: currentStock.map((s) => ({
                            variantId: s.variantId,
                            expectedQuantity: s.quantity,
                        })),
                    },
                },
                include: {
                    location: true,
                    performedBy: { select: { id: true, name: true, email: true, role: true } },
                    items: {
                        include: {
                            variant: { include: { product: true, variantBarcodes: true } },
                        },
                    },
                },
            });
        });

        return this.maskSessionIfBlind(session, user);
    }

    async claimSession(sessionId: string, user: AuthUser) {
        const session = await this.prisma.stocktakeSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException('A leltár munkamenet nem található');
        }

        await this.locationAccessService.assertCanAccess(user, session.locationId);

        if (session.status !== StocktakeStatus.IN_PROGRESS) {
            throw new BadRequestException('Csak folyamatban lévő (IN_PROGRESS) leltárfeladat vehető fel');
        }

        if (session.performedByUserId && session.performedByUserId !== user.userId) {
            throw new ConflictException('Ezt a leltárfeladatot már felvette egy másik dolgozó');
        }

        const updated = await this.prisma.stocktakeSession.update({
            where: { id: sessionId },
            data: { performedByUserId: user.userId },
            include: {
                location: true,
                performedBy: { select: { id: true, name: true, email: true, role: true } },
                items: {
                    include: {
                        variant: {
                            include: {
                                product: true,
                                variantBarcodes: {
                                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                                },
                            },
                        },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        return this.maskSessionIfBlind(updated, user);
    }

    /**
     * Közös belső segédfüggvény egy tétel vagy tétellista (batch) mentéséhez tranzakcióban.
     */
    private async upsertCountedItems(
        sessionId: string,
        itemsToSave: RecordStocktakeItemDto[],
        fillMissingAsZero: boolean,
    ) {
        if (itemsToSave.length > 0) {
            const variantIds = [...new Set(itemsToSave.map((i) => i.variantId))];
            const foundVariants = await this.prisma.variant.findMany({
                where: { id: { in: variantIds } },
                select: { id: true },
            });
            if (foundVariants.length !== variantIds.length) {
                throw new NotFoundException('Egy vagy több megadott termékvariáns nem található');
            }
        }

        return this.prisma.$transaction(async (tx) => {
            const existingItems = await tx.stocktakeItem.findMany({
                where: { stocktakeSessionId: sessionId },
            });
            const existingMap = new Map(existingItems.map((i) => [i.variantId, i]));
            const incomingVariantIds = new Set<string>();

            for (const dto of itemsToSave) {
                incomingVariantIds.add(dto.variantId);
                const existing = existingMap.get(dto.variantId);

                if (existing) {
                    const discrepancy = dto.countedQuantity - existing.expectedQuantity;
                    await tx.stocktakeItem.update({
                        where: { id: existing.id },
                        data: {
                            countedQuantity: dto.countedQuantity,
                            discrepancy,
                            note: dto.note ?? existing.note,
                        },
                    });
                } else {
                    await tx.stocktakeItem.create({
                        data: {
                            stocktakeSessionId: sessionId,
                            variantId: dto.variantId,
                            expectedQuantity: 0,
                            countedQuantity: dto.countedQuantity,
                            discrepancy: dto.countedQuantity,
                            note: dto.note,
                        },
                    });
                }
            }

            // Ha végleges beküldés (submit) történik, minden olyan eredeti tételt, amit még nem számoltak meg,
            // és a beküldött tömbben sem szerepel, 0 darabra állítunk (teljes hiány a polcon).
            if (fillMissingAsZero) {
                for (const existing of existingItems) {
                    if (
                        existing.countedQuantity === null &&
                        !incomingVariantIds.has(existing.variantId)
                    ) {
                        await tx.stocktakeItem.update({
                            where: { id: existing.id },
                            data: {
                                countedQuantity: 0,
                                discrepancy: -existing.expectedQuantity,
                            },
                        });
                    }
                }
            }
        });
    }

    /**
     * Időszakos piszkozat-mentés (Auto-sync tömbbel) — IN_PROGRESS marad.
     */
    async syncItems(sessionId: string, dto: SubmitStocktakeDto, user: AuthUser) {
        const session = await this.prisma.stocktakeSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException('A leltár munkamenet nem található');
        }

        await this.locationAccessService.assertCanAccess(user, session.locationId);

        if (session.status !== StocktakeStatus.IN_PROGRESS) {
            throw new BadRequestException('Csak folyamatban lévő (IN_PROGRESS) leltár tételei szinkronizálhatók');
        }

        if (
            session.performedByUserId &&
            session.performedByUserId !== user.userId &&
            this.isBlindRole(user.role)
        ) {
            throw new ForbiddenException('Ezt a leltárfeladatot már egy másik dolgozó végzi');
        }

        if (!session.performedByUserId) {
            await this.prisma.stocktakeSession.update({
                where: { id: sessionId },
                data: { performedByUserId: user.userId },
            });
        }

        if (dto.items && dto.items.length > 0) {
            await this.upsertCountedItems(sessionId, dto.items, false);
        }

        return this.findOne(sessionId, user);
    }

    /**
     * Egyetlen tétel mentése (ha valaki egyesével szeretné hívni).
     */
    async recordItem(sessionId: string, dto: RecordStocktakeItemDto, user: AuthUser) {
        await this.syncItems(sessionId, { items: [dto] }, user);
        const item = await this.prisma.stocktakeItem.findUnique({
            where: {
                stocktakeSessionId_variantId: {
                    stocktakeSessionId: sessionId,
                    variantId: dto.variantId,
                },
            },
            include: { variant: { include: { product: true } } },
        });
        return this.maskItemIfBlind(item!, user);
    }

    /**
     * Leltár végleges beküldése jóváhagyásra (fogadja a kliens lokális tételeit egyben is!).
     */
    async submitForApproval(sessionId: string, dto: SubmitStocktakeDto | undefined, user: AuthUser) {
        const session = await this.prisma.stocktakeSession.findUnique({
            where: { id: sessionId },
            include: { items: true },
        });
        if (!session) {
            throw new NotFoundException('A leltár munkamenet nem található');
        }

        await this.locationAccessService.assertCanAccess(user, session.locationId);

        if (session.status !== StocktakeStatus.IN_PROGRESS) {
            throw new BadRequestException('Csak folyamatban lévő leltár küldhető be jóváhagyásra');
        }

        if (
            session.performedByUserId &&
            session.performedByUserId !== user.userId &&
            this.isBlindRole(user.role)
        ) {
            throw new ForbiddenException('Ezt a leltárfeladatot már egy másik dolgozó végzi');
        }

        // Ha a kliens beküldte a számolt tételek tömbjét a submit-ban, elmentjük őket,
        // és a nem érintett tételeket 0-ra állítjuk.
        if (dto?.items) {
            await this.upsertCountedItems(sessionId, dto.items, true);
        } else {
            const uncounted = session.items.filter((i) => i.countedQuantity === null);
            if (uncounted.length > 0) {
                throw new BadRequestException(
                    `Még ${uncounted.length} db tétel nincs megszámolva a leltáríven`,
                );
            }
        }

        const updated = await this.prisma.stocktakeSession.update({
            where: { id: sessionId },
            data: {
                status: StocktakeStatus.WAITING_FOR_APPROVAL,
                performedByUserId: session.performedByUserId ?? user.userId,
            },
            include: {
                location: true,
                performedBy: { select: { id: true, name: true, email: true, role: true } },
                items: {
                    include: { variant: { include: { product: true } } },
                },
            },
        });

        return this.maskSessionIfBlind(updated, user);
    }

    async approveSession(sessionId: string, user: AuthUser) {
        const session = await this.prisma.stocktakeSession.findUnique({
            where: { id: sessionId },
            include: { items: true, location: true },
        });
        if (!session) {
            throw new NotFoundException('A leltár munkamenet nem található');
        }

        await this.locationAccessService.assertCanAccess(user, session.locationId);

        if (
            session.status !== StocktakeStatus.WAITING_FOR_APPROVAL &&
            session.status !== StocktakeStatus.IN_PROGRESS
        ) {
            throw new BadRequestException('Ez a leltár már le lett zárva vagy törölve lett');
        }

        const uncounted = session.items.filter((i) => i.countedQuantity === null);
        if (uncounted.length > 0) {
            throw new BadRequestException(
                `Nem hagyható jóvá a leltár, amíg ${uncounted.length} db tétel nincs megszámolva`,
            );
        }

        if (session.location.slotMode === SlotMode.DEDICATED) {
            const positiveVariants = session.items.filter((i) => (i.countedQuantity ?? 0) > 0);
            if (positiveVariants.length > 1) {
                throw new ConflictException(
                    'DEDICATED (dedikált) tárolóhelyen nem lehet egyszerre több különböző variánsból pozitív készlet',
                );
            }
        }

        return this.prisma.$transaction(async (tx) => {
            for (const item of session.items) {
                const counted = item.countedQuantity!;

                const existingStock = await tx.stockItem.findUnique({
                    where: {
                        variantId_locationId: {
                            variantId: item.variantId,
                            locationId: session.locationId,
                        },
                    },
                });

                const currentQty = existingStock?.quantity ?? 0;
                const diff = counted - currentQty;

                await tx.stocktakeItem.update({
                    where: { id: item.id },
                    data: {
                        expectedQuantity: currentQty,
                        discrepancy: diff,
                    },
                });

                await tx.stockItem.upsert({
                    where: {
                        variantId_locationId: {
                            variantId: item.variantId,
                            locationId: session.locationId,
                        },
                    },
                    create: {
                        variantId: item.variantId,
                        locationId: session.locationId,
                        quantity: counted,
                    },
                    update: {
                        quantity: counted,
                    },
                });

                if (diff !== 0) {
                    await tx.stockMovement.create({
                        data: {
                            type: MovementType.STOCKTAKE_ADJUSTMENT,
                            stocktakeSessionId: session.id,
                            variantId: item.variantId,
                            locationId: session.locationId,
                            quantity: diff,
                            note:
                                item.note ??
                                `Leltárkorrekció (várt: ${currentQty}, számolt: ${counted})`,
                            createdByUserId: user.userId,
                        },
                    });
                }
            }

            return tx.stocktakeSession.update({
                where: { id: session.id },
                data: {
                    status: StocktakeStatus.COMPLETED,
                    completedAt: new Date(),
                    approvedByUserId: user.userId,
                },
                include: {
                    location: true,
                    items: {
                        include: { variant: { include: { product: true } } },
                    },
                    stockMovements: true,
                },
            });
        });
    }

    async cancelSession(sessionId: string, user: AuthUser) {
        const session = await this.prisma.stocktakeSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException('A leltár munkamenet nem található');
        }

        await this.locationAccessService.assertCanAccess(user, session.locationId);

        if (session.status === StocktakeStatus.COMPLETED) {
            throw new BadRequestException('Már jóváhagyott (COMPLETED) leltárt nem lehet visszavonni');
        }

        return this.prisma.stocktakeSession.update({
            where: { id: sessionId },
            data: { status: StocktakeStatus.CANCELLED },
        });
    }
}
