import { ExpressAdapter } from '@nestjs/platform-express';
import { isBodyParserError } from './body-parser-error.js';

/**
 * O ExpressAdapter padrão converte todo SyntaxError em
 * `new BadRequestException(error.message)` antes de chegar aos filtros. Com
 * isso o JSON malformado já saía 400, mas com a mensagem interna do parser, e
 * o filtro global perdia o campo `type` do erro. Este adapter entrega os erros
 * do body-parser intactos ao AllExceptionsFilter, que decide status e mensagem.
 */
export class AppExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    if (isBodyParserError(error)) return error;
    return super.mapException(error);
  }
}
