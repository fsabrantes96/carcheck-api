import { ApiProperty } from '@nestjs/swagger';
import { ListingResponseDto } from './listing-response.dto.js';

export class PaginatedListingsResponseDto {
    @ApiProperty({ type: ListingResponseDto, isArray: true })
    items: ListingResponseDto[];

    @ApiProperty({ type: 'integer' }) total: number;
    @ApiProperty({ type: 'integer' }) page: number;
    @ApiProperty({ type: 'integer' }) limit: number;
}