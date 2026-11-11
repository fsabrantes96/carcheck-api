import { PartialType } from '@nestjs/swagger';
import { CreateListingDto } from './create-listing.dto.js';

/**
 * Update parcial do anúncio. O status não entra aqui: ele muda só pelas rotas
 * de transição (pause, activate, mark-sold e DELETE, que arquiva). Enviar
 * `status` no PATCH responde 400 pelo whitelist do ValidationPipe.
 */
export class UpdateListingDto extends PartialType(CreateListingDto) {}
