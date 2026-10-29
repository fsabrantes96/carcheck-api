import { ApiProperty } from '@nestjs/swagger';
import { ListingResponseDto } from './listing-response.dto.js';

export class PaginatedListingsResponseDto {
    @ApiProperty({ type: ListingResponseDto, isArray: true })
    items: ListingResponseDto[];

    @ApiProperty() total: number;
    @ApiProperty() page: number;
    @ApiProperty() limit: number;
}