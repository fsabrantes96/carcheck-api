import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiExtraModels,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
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
import {
    APPOINTMENT_RESPONSE_MODELS,
    appointmentResponseSchema,
    BuyerAppointmentResponseDto,
    InspectorAppointmentResponseDto,
    SellerAppointmentResponseDto,
} from './dto/appointment-response.dto.js';
import { ConfirmAppointmentDto } from './dto/confirm-appointment.dto.js';
import type { AppointmentResponseDto } from './dto/appointment-response.dto.js';
import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto.js';
import { PaginatedAppointmentsResponseDto } from './dto/paginated-appointments-response.dto.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';

/**
 * Agendamento é recurso privado: só os participantes sabem que ele existe
 * (404 para os demais). Sem RolesGuard: vale o papel do usuário NAQUELE
 * agendamento, não a role global.
 */
@ApiTags('appointments')
@ApiExtraModels(...APPOINTMENT_RESPONSE_MODELS)
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

    // Rotas estáticas antes de ':id'.
    @Get()
    @ApiOkResponse({ type: PaginatedAppointmentsResponseDto })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Filtros inválidos (as, status, page, limit <= 50)' })
    list(
        @CurrentUser() user: JwtPayload,
        @Query() query: ListAppointmentsQueryDto,
    ): Promise<PaginatedAppointmentsResponseDto> {
        return this.appointments.list(user.sub, query);
    }

    @Get(':id')
    @ApiOkResponse({ schema: appointmentResponseSchema(), description: 'Formato conforme o seu papel (myRole)' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Agendamento não encontrado (ou você não participa dele)' })
    findOne(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<AppointmentResponseDto> {
        return this.appointments.findOne(id, user.sub);
    }

    @Post(':id/accept')
    @HttpCode(200)
    @ApiOkResponse({ type: InspectorAppointmentResponseDto, description: 'Aceito (REQUESTED → ACCEPTED); ocupa o horário do avaliador' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Você não pode aceitar este agendamento (só o avaliador)' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Agendamento não encontrado (ou você não participa dele)' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Estado não permite, prazo expirado, perfil não verificado, estado mudou ou horário não está mais disponível' })
    accept(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<InspectorAppointmentResponseDto> {
        return this.appointments.accept(id, user.sub);
    }

    @Post(':id/decline')
    @HttpCode(200)
    @ApiOkResponse({ type: InspectorAppointmentResponseDto, description: 'Recusado (REQUESTED → DECLINED)' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Você não pode recusar este agendamento (só o avaliador)' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Agendamento não encontrado (ou você não participa dele)' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Estado não permite, prazo expirado ou estado mudou' })
    decline(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<InspectorAppointmentResponseDto> {
        return this.appointments.decline(id, user.sub);
    }

    @Post(':id/confirm')
    @HttpCode(200)
    @ApiOkResponse({ type: SellerAppointmentResponseDto, description: 'Confirmado (ACCEPTED → AWAITING_PAYMENT); abre a janela de 30 min para pagar' })
    @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'meetingAddress ausente ou fora de 5 a 300 caracteres' })
    @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Você não pode confirmar este agendamento (só o vendedor)' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Agendamento não encontrado (ou você não participa dele)' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Estado não permite, prazo expirado ou estado mudou' })
    confirm(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
        @Body() dto: ConfirmAppointmentDto,
    ): Promise<SellerAppointmentResponseDto> {
        return this.appointments.confirm(id, user.sub, dto);
    }

    @Post(':id/cancel')
    @HttpCode(200)
    @ApiOkResponse({ schema: appointmentResponseSchema(), description: 'Cancelado (antes do pagamento); formato conforme o seu papel' })
    @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Agendamento não encontrado (ou você não participa dele)' })
    @ApiConflictResponse({ type: ErrorResponseDto, description: 'Estado não permite (ex.: já pago ou encerrado), prazo expirado ou estado mudou' })
    cancel(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: JwtPayload,
    ): Promise<AppointmentResponseDto> {
        return this.appointments.cancel(id, user.sub);
    }
}
