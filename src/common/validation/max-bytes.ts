import { ValidateBy } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';

export const MAX_BYTES = 'maxBytes';

/**
 * Tamanho máximo de uma string em bytes UTF-8 (não em caracteres): "é" ocupa
 * 2 bytes e um emoji, 4. Valor que não é string falha, como no `@MaxLength`.
 */
export function MaxBytes(max: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: MAX_BYTES,
      constraints: [max],
      validator: {
        validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property ?? 'valor'} deve ter no máximo ${max} bytes`,
      },
    },
    options,
  );
}
