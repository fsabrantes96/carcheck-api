import { ARRAY_UNIQUE, ValidateBy } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Mesmo contrato do `@ArrayUnique` do class-validator (nome da regra e
 * mensagem), mas em O(n) com Set. O original usa `filter` + `indexOf`
 * (O(n²)) e roda mesmo quando o `@ArrayMaxSize` já falhou: um array de
 * ~20 mil itens dentro dos 100kb travava o event loop por centenas de ms.
 */
export function UniqueArray(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: ARRAY_UNIQUE,
      validator: {
        validate: (value: unknown) => Array.isArray(value) && new Set(value).size === value.length,
        defaultMessage: (args?: ValidationArguments) =>
          `All ${args?.property ?? 'array'}'s elements must be unique`,
      },
    },
    options,
  );
}
