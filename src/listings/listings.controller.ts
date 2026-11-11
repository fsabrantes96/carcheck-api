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
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { CreateListingDto } from './dto/create-listing.dto.js';
import { ListListingsQueryDto } from './dto/list-listings-query.dto.js';
import { ListingResponseDto } from './dto/listing-response.dto.js';
import { MyListingResponseDto } from './dto/my-listing-response.dto.js';
import { PaginatedListingsResponseDto } from './dto/paginated-listings-response.dto.js';
import { UpdateListingDto } from './dto/update-listing.dto.js';
import { ListingsService } from './listings.service.js';

@ApiTags('listings')
@Controller('listings')
export class ListingsController {
    constructor(private readonly listings: ListingsService) { }

    @Get()
    @ApiOkResponse({ type: PaginatedListingsResponseDto })
    findAll(@Query() query: ListListingsQueryDto): Promise<PaginatedListingsResponseDto> {
        return this.listings.findAll(query);
    }

    @Get('mine')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({ type: MyListingResponseDto, isArray: true, description: 'Anúncios do usuário, sem os arquivados' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    findMine(@CurrentUser() user: JwtPayload): Promise<MyListingResponseDto[]> {
        return this.listings.findMine(user.sub);
    }

    @Get(':id')
    @ApiOkResponse({ type: ListingResponseDto })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
    findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ListingResponseDto> {
        return this.listings.findOnePublic(id);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiCreatedResponse({ type: MyListingResponseDto })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateListingDto,
    ): Promise<MyListingResponseDto> {
        return this.listings.create(user.sub, dto);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({ type: MyListingResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos (inclusive enviar status, que muda só pelas rotas de transição)' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Este anúncio não pertence a você' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
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
    @ApiOkResponse({ type: MyListingResponseDto, description: 'Anúncio pausado (ACTIVE → PAUSED). Os agendamentos em aberto do anúncio (REQUESTED, ACCEPTED, AWAITING_PAYMENT) são cancelados (CANCELLED, endedBy SELLER).' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Este anúncio não pertence a você' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Ação não permitida no status atual do anúncio, ou o status mudou durante a requisição, ou há avaliação paga em andamento (agendamento PAID)' })
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
    @ApiOkResponse({ type: MyListingResponseDto, description: 'Anúncio reativado (PAUSED → ACTIVE)' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Este anúncio não pertence a você' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Ação não permitida no status atual do anúncio, ou o status mudou durante a requisição' })
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
    @ApiOkResponse({ type: MyListingResponseDto, description: 'Anúncio marcado como vendido (ACTIVE ou PAUSED → SOLD). Os agendamentos em aberto do anúncio (REQUESTED, ACCEPTED, AWAITING_PAYMENT) são cancelados (CANCELLED, endedBy SELLER).' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Este anúncio não pertence a você' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Ação não permitida no status atual do anúncio, ou o status mudou durante a requisição, ou há avaliação paga em andamento (agendamento PAID)' })
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
    @ApiNoContentResponse({ description: 'Anúncio arquivado (status ARCHIVED); não é apagado do banco. Os agendamentos em aberto do anúncio (REQUESTED, ACCEPTED, AWAITING_PAYMENT) são cancelados (CANCELLED, endedBy SELLER).' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Este anúncio não pertence a você' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Anúncio já arquivado, ou o status mudou durante a requisição, ou há avaliação paga em andamento (agendamento PAID)' })
    remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<void> {
        return this.listings.remove(id, user.sub);
    }
}