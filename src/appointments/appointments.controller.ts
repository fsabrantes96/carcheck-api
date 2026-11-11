import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiTags,
    ApiTooManyRequestsResponse,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { APPOINTMENT_CREATE_THROTTLE } from '../common/throttler/throttler.config.js';
import { AppointmentsService } from './appointments.service.js';
import { BuyerAppointmentResponseDto } from './dto/appointment-response.dto.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';

/**
 * Agendamento é recurso privado: só os participantes sabem que ele existe
 * (404 para os demais). Sem RolesGuard: vale o papel do usuário NAQUELE
 * agendamento, não a role global.
 */
@ApiTags('appointments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Token ausente, inválido ou expirado' })
@UseGuards(JwtAuthGuard)
@Controller('appointments')
export class AppointmentsController {
    constructor(private readonly appointments: AppointmentsService) { }

    @Post()
    @Throttle(APPOINTMENT_CREATE_THROTTLE)
    @ApiCreatedResponse({ type: BuyerAppointmentResponseDto, description: 'Pedido criado (REQUESTED); quem pede vira o comprador' })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos (inclusive campos não permitidos como status, preço, comprador ou vendedor), antecedência mínima ou horizonte de 60 dias' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Agendar no próprio anúncio, ou consigo mesmo como avaliador' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Anúncio não encontrado (ou não ACTIVE), ou avaliador não encontrado (ou não verificado)' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Avaliador indisponível para o anúncio, preço abaixo do mínimo, horário ocupado ou pedido em andamento duplicado' })
    @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Mais de 10 pedidos por minuto' })
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateAppointmentDto,
    ): Promise<BuyerAppointmentResponseDto> {
        return this.appointments.create(user.sub, dto);
    }
}
