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
    ApiBearerAuth,
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
    @ApiOkResponse({ type: ListingResponseDto, isArray: true })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    findMine(@CurrentUser() user: JwtPayload): Promise<ListingResponseDto[]> {
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
    @ApiCreatedResponse({ type: ListingResponseDto })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateListingDto,
    ): Promise<ListingResponseDto> {
        return this.listings.create(user.sub, dto);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({ type: ListingResponseDto })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Este anúncio não pertence a você' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
        @Body() dto: UpdateListingDto,
    ): Promise<ListingResponseDto> {
        return this.listings.update(id, user.sub, dto);
    }

    @Delete(':id')
    @HttpCode(204)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiNoContentResponse({ description: 'Anúncio removido' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Este anúncio não pertence a você' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado' })
    remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<void> {
        return this.listings.remove(id, user.sub);
    }
}