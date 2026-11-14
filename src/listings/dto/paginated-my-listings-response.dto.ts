import { ApiProperty } from '@nestjs/swagger';
import { MyListingResponseDto } from './my-listing-response.dto.js';

/** Página de GET /listings/mine: os anúncios do dono, com status. */
export class PaginatedMyListingsResponseDto {
    @ApiProperty({ type: MyListingResponseDto, isArray: true })
    items: MyListingResponseDto[];

    @ApiProperty({ type: 'integer', description: 'Total de anúncios do dono (sem os arquivados), em todas as páginas' })
    total: number;
    @ApiProperty({ type: 'integer' }) page: number;
    @ApiProperty({ type: 'integer' }) limit: number;
}
