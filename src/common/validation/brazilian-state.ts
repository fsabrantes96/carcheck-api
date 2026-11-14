import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { STATE_LENGTH } from '../limits.js';

/** As 27 unidades federativas: 26 estados e o Distrito Federal. */
export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export type BrazilianState = (typeof BRAZILIAN_STATES)[number];

/**
 * Schema reutilizável no OpenAPI (components.schemas.BrazilianState): o
 * front recebe um único tipo para todos os campos de UF.
 */
const SWAGGER = {
  enum: BRAZILIAN_STATES,
  enumName: 'BrazilianState',
  example: 'SP',
  description: 'Sigla da UF (uma das 27)',
  minLength: STATE_LENGTH,
  maxLength: STATE_LENGTH,
};

/** Para os Response DTOs: só a documentação (o valor vem do banco). */
export function ApiBrazilianState(): PropertyDecorator {
  return ApiProperty(SWAGGER);
}

/**
 * Campo de entrada com a UF: tira espaços e passa para maiúsculas ("sp" e
 * " SP " viram "SP") e aceita só as 27 siglas. O @IsIn compara o texto
 * inteiro, então caracteres invisíveis (S️P️) não passam, ao
 * contrário do antigo @Length(2, 2). Valor que não é texto segue intacto e
 * cai no @IsIn.
 */
export function BrazilianStateField(
  options: { optional?: boolean } = {},
): PropertyDecorator {
  return applyDecorators(
    options.optional ? ApiPropertyOptional(SWAGGER) : ApiProperty(SWAGGER),
    ...(options.optional ? [IsOptional()] : []),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toUpperCase() : value,
    ),
    IsIn(BRAZILIAN_STATES),
  );
}
