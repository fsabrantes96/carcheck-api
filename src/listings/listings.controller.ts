import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import {
    ApiBodyErrorResponses,
    ApiCommonErrorResponses,
    ApiUuidParam,
    INVALID_UUID_DESCRIPTION,
    TRANSACTION_CONFLICT_DESCRIPTION,
    UNAUTHORIZED_DESCRIPTION,
} from '../common/swagger/api-responses.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { CreateListingDto } from './dto/create-listing.dto.js';
import { ListListingsQueryDto } from './dto/list-listings-query.dto.js';
import { ListingResponseDto } from './dto/listing-response.dto.js';
import { MyListingResponseDto } from './dto/my-listing-response.dto.js';
import { ListingsPageQueryDto } from './dto/listings-page-query.dto.js';
import { PaginatedListingsResponseDto } from './dto/paginated-listings-response.dto.js';
import { PaginatedMyListingsResponseDto } from './dto/paginated-my-listings-response.dto.js';
import { UpdateListingDto } from './dto/update-listing.dto.js';
import { ListingsService } from './listings.service.js';

const NOT_OWNER = 'Este anúncio não pertence a você';
const NOT_FOUND = 'Anúncio não encontrado';
const CANCELS_OPEN_APPOINTMENTS =
    'Os agendamentos em aberto do anúncio (REQUESTED, ACCEPTED, AWAITING_PAYMENT) são cancelados (CANCELLED, endedBy SELLER).';

@ApiTags('listings')
@ApiCommonErrorResponses()
@Controller('listings')
export class ListingsController {
    constructor(private readonly listings: ListingsService) { }

    @Get()
    @ApiOkResponse({ type: PaginatedListingsResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Filtros inválidos (lista em errors): UF fora das 27, page de 1 a 200, limit de 1 a 50, faixas de preço e ano' })
    findAll(@Query() query: ListListingsQueryDto): Promise<PaginatedListingsResponseDto> {
        return this.listings.findAll(query);
    }

    @Get('mine')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({ type: PaginatedMyListingsResponseDto, description: 'Anúncios do usuário, sem os arquivados, paginados' })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Paginação inválida (page de 1 a 200, limit de 1 a 50)' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
    findMine(
        @CurrentUser() user: JwtPayload,
        @Query() query: ListingsPageQueryDto,
    ): Promise<PaginatedMyListingsResponseDto> {
        return this.listings.findMine(user.sub, query);
    }

    @Get(':id')
    @ApiUuidParam()
    @ApiOkResponse({ type: ListingResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: INVALID_UUID_DESCRIPTION })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: NOT_FOUND })
    findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ListingResponseDto> {
        return this.listings.findOnePublic(id);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiCreatedResponse({ type: MyListingResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos (lista em errors) ou corpo malformado' })
    @ApiBodyErrorResponses()
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateListingDto,
    ): Promise<MyListingResponseDto> {
        return this.listings.create(user.sub, dto);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiUuidParam()
    @ApiOkResponse({ type: MyListingResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: `${INVALID_UUID_DESCRIPTION}, ou dados inválidos (inclusive enviar status, que muda só pelas rotas de transição)` })
    @ApiBodyErrorResponses()
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: NOT_OWNER })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: NOT_FOUND })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Anúncio arquivado não pode ser alterado' })
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
        @Body() dto: UpdateListingDto,
    ): Promise<MyListingResponseDto> {
        return this.listings.update(id, user.sub, dto);
    }

    @Post(':id/pause')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiUuidParam()
    @ApiOkResponse({ type: MyListingResponseDto, description: `Anúncio pausado (ACTIVE → PAUSED). ${CANCELS_OPEN_APPOINTMENTS}` })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: INVALID_UUID_DESCRIPTION })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: NOT_OWNER })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: NOT_FOUND })
    @ApiConflictResponse({ type: ErrorResponseDto, description: `Ação não permitida no status atual do anúncio, ou o status mudou durante a requisição, ou há avaliação paga em andamento (agendamento PAID), ${TRANSACTION_CONFLICT_DESCRIPTION}` })
    pause(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<MyListingResponseDto> {
        return this.listings.pause(id, user.sub);
    }

    @Post(':id/activate')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiUuidParam()
    @ApiOkResponse({ type: MyListingResponseDto, description: 'Anúncio reativado (PAUSED → ACTIVE)' })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: INVALID_UUID_DESCRIPTION })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: NOT_OWNER })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: NOT_FOUND })
    @ApiConflictResponse({ type: ErrorResponseDto, description: `Ação não permitida no status atual do anúncio, ou o status mudou durante a requisição, ${TRANSACTION_CONFLICT_DESCRIPTION}` })
    activate(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<MyListingResponseDto> {
        return this.listings.activate(id, user.sub);
    }

    @Post(':id/mark-sold')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiUuidParam()
    @ApiOkResponse({ type: MyListingResponseDto, description: `Anúncio marcado como vendido (ACTIVE ou PAUSED → SOLD). ${CANCELS_OPEN_APPOINTMENTS}` })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: INVALID_UUID_DESCRIPTION })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: NOT_OWNER })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: NOT_FOUND })
    @ApiConflictResponse({ type: ErrorResponseDto, description: `Ação não permitida no status atual do anúncio, ou o status mudou durante a requisição, ou há avaliação paga em andamento (agendamento PAID), ${TRANSACTION_CONFLICT_DESCRIPTION}` })
    markSold(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<MyListingResponseDto> {
        return this.listings.markSold(id, user.sub);
    }

    @Delete(':id')
    @HttpCode(204)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiUuidParam()
    @ApiNoContentResponse({ description: `Anúncio arquivado (status ARCHIVED); não é apagado do banco. ${CANCELS_OPEN_APPOINTMENTS}` })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: INVALID_UUID_DESCRIPTION })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: NOT_OWNER })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: NOT_FOUND })
    @ApiConflictResponse({ type: ErrorResponseDto, description: `Anúncio já arquivado, ou o status mudou durante a requisição, ou há avaliação paga em andamento (agendamento PAID), ${TRANSACTION_CONFLICT_DESCRIPTION}` })
    remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<void> {
        return this.listings.remove(id, user.sub);
    }
}
