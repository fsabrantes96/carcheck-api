import { ExpressAdapter } from '@nestjs/platform-express';
import { isBodyParserError } from './body-parser-error.js';

/**
 * O ExpressAdapter padrão (Nest 12.5) converte SyntaxError/URIError com
 * status 400, e outros http-errors 4xx, em HttpException com a mensagem do
 * erro antes de chegar aos filtros. Os erros do body-parser se encaixam nisso:
 * o JSON malformado sairia 400 com a mensagem interna do parser, e o filtro
 * global perderia o campo `type` do erro. Este adapter entrega os erros do
 * body-parser intactos ao AllExceptionsFilter, que decide status e mensagem.
 * O mapException só é chamado para erros da camada do Express (middlewares
 * registrados com app.use, parsers, assets estáticos, router).
 */
export class AppExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    if (isBodyParserError(error)) return error;
    return super.mapException(error);
  }
}
