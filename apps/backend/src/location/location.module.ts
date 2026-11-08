import { Module } from "@nestjs/common";
import { LocationService } from "./location.service";
import { LocationController } from "./location.controller";
import { LocationAccessService } from "./location-access.service";


@Module({
    controllers: [LocationController],
    providers: [LocationService, LocationAccessService],
    exports: [LocationAccessService]
})
export class LocationModule{}