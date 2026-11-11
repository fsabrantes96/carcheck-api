import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { CreateInspectorProfileDto } from './dto/create-inspector-profile.dto.js';
import { InspectorResponseDto } from './dto/inspector-response.dto.js';
import { MyInspectorProfileResponseDto } from './dto/my-inspector-profile-response.dto.js';
import { UpdateInspectorProfileDto } from './dto/update-inspector-profile.dto.js';
import { InspectorsService } from './inspectors.service.js';

@ApiTags('inspectors')
@Controller('inspectors')
export class InspectorsController {
    constructor(private readonly inspectors: InspectorsService) { }


    @Get()
    @ApiOkResponse({ type: InspectorResponseDto, isArray: true })
    findAll(): Promise<InspectorResponseDto[]> {
        return this.inspectors.findAllVerified();
    }

    @Post('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiCreatedResponse({ type: InspectorResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos ou preço base abaixo de MIN_INSPECTION_PRICE_CENTS' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Você já possui perfil de avaliador' })
    @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateInspectorProfileDto,
    ): Promise<InspectorResponseDto> {
        return this.inspectors.create(user.sub, dto);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('INSPECTOR')
    @ApiBearerAuth()
    @ApiOkResponse({ type: MyInspectorProfileResponseDto, description: 'Perfil do avaliador com a comissão atual e o repasse estimado' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Você não é avaliador' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Perfil de avaliador não encontrado' })
    findMine(@CurrentUser() user: JwtPayload): Promise<MyInspectorProfileResponseDto> {
        return this.inspectors.findMine(user.sub);
    }

    @Patch('me')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('INSPECTOR')
    @ApiBearerAuth()
    @ApiOkResponse({ type: InspectorResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos ou basePriceCents (quando enviado) abaixo de MIN_INSPECTION_PRICE_CENTS' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Você não é avaliador' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Perfil de avaliador não encontrado' })
    update(
        @CurrentUser() user: JwtPayload,
        @Body() dto: UpdateInspectorProfileDto,
    ): Promise<InspectorResponseDto> {
        return this.inspectors.update(user.sub, dto);
    }
}