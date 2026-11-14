import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Formato único de erro devolvido por toda a API (ver AllExceptionsFilter).
 */
export class ErrorResponseDto {
  @ApiProperty({ type: 'integer', example: 404, description: 'Status HTTP' })
  statusCode: number;

  @ApiProperty({ example: 'Not Found', description: 'Nome do status HTTP' })
  error: string;

  @ApiProperty({ example: 'Anúncio não encontrado' })
  message: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Lista de erros de validação (só em 400 de validação)',
    example: ['email must be an email'],
  })
  errors?: string[];

  @ApiProperty({ example: '/listings/123', description: 'URL da requisição, com a query string' })
  path: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-10T12:00:00.000Z' })
  timestamp: string;
}
