import { ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import {ListingStatus } from "../../generated/prisma/client.js";
import { CreateListingDto } from "./create-listing.dto.js";

export class UpdateListingDto extends PartialType(CreateListingDto) {
    @ApiPropertyOptional({enum: ListingStatus})
    @IsOptional()
    @IsEnum(ListingStatus)
    status: ListingStatus;
}