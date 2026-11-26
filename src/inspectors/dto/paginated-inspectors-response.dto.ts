import { ApiProperty } from '@nestjs/swagger';
import { InspectorResponseDto } from './inspector-response.dto.js';

/** Página de GET /inspectors: só perfis verificados. */
export class PaginatedInspectorsResponseDto {
  @ApiProperty({ type: InspectorResponseDto, isArray: true })
  items: InspectorResponseDto[];

  @ApiProperty({
    type: 'integer',
    description: 'Total de perfis verificados, em todas as páginas',
  })
  total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) limit: number;
}
