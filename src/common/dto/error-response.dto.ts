import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Formato único de erro devolvido por toda a API (ver AllExceptionsFilter).
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
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

  @ApiProperty({ example: '/listings/123' })
  path: string;

  @ApiProperty({ example: '2026-11-10T12:00:00.000Z' })
  timestamp: string;
}
