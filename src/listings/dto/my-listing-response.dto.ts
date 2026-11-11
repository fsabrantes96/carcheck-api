import { ApiProperty } from '@nestjs/swagger';
import { ListingStatus } from '../../generated/prisma/client.js';
import { ListingResponseDto } from './listing-response.dto.js';
import type { ListingWithRelations } from './listing-response.dto.js';

/**
 * Resposta das rotas do dono do anúncio (POST /listings, GET /listings/mine,
 * PATCH, pause, activate e mark-sold): os campos públicos mais o status.
 */
export class MyListingResponseDto extends ListingResponseDto {
    @ApiProperty({ enum: ListingStatus }) status: ListingStatus;

    static override from(listing: ListingWithRelations): MyListingResponseDto {
        const dto = ListingResponseDto.fillPublicFields(new MyListingResponseDto(), listing);
        dto.status = listing.status;
        return dto;
    }
}
