import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { CreateInspectorProfileDto } from './dto/create-inspector-profile.dto.js';
import { InspectorResponseDto } from './dto/inspector-response.dto.js';
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
    @ApiConflictResponse({ description: 'Você já possui perfil de avaliador' })
    @ApiUnauthorizedResponse({ description: 'Token ausente, inválido ou expirado' })
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
    @ApiOkResponse({ type: InspectorResponseDto })
    @ApiForbiddenResponse({ description: 'Você não é avaliador' })
    @ApiNotFoundResponse({ description: 'Perfil de avaliador não encontrado' })
    findMine(@CurrentUser() user: JwtPayload): Promise<InspectorResponseDto> {
        return this.inspectors.findMine(user.sub);
    }

    @Patch('me')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('INSPECTOR')
    @ApiBearerAuth()
    @ApiOkResponse({ type: InspectorResponseDto })
    @ApiForbiddenResponse({ description: 'Você não é avaliador' })
    @ApiNotFoundResponse({ description: 'Perfil de avaliador não encontrado' })
    update(
        @CurrentUser() user: JwtPayload,
        @Body() dto: UpdateInspectorProfileDto,
    ): Promise<InspectorResponseDto> {
        return this.inspectors.update(user.sub, dto);
    }
}