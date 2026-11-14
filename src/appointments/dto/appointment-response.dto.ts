import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { ApiBrazilianState } from '../../common/validation/brazilian-state.js';
import { AppointmentActor, AppointmentStatus } from '../../generated/prisma/client.js';
import { availableActions, ROUTE_ACTIONS } from '../appointments.state-machine.js';
import type { AppointmentAction, Participant } from '../appointments.state-machine.js';

/** Agendamento com as relações de APPOINTMENT_INCLUDE (formato estrutural). */
export type AppointmentWithRelations = {
    id: string;
    status: AppointmentStatus;
    startsAt: Date;
    endsAt: Date;
    expiresAt: Date | null;
    meetingAddress: string | null;
    endedBy: AppointmentActor | null;
    priceCents: number;
    platformFeeBps: number;
    platformFeeCents: number;
    inspectorPayoutCents: number;
    createdAt: Date;
    listing: { id: string; title: string; city: string; state: string };
    buyer: { name: string };
    seller: { name: string };
    inspector: { name: string; inspectorProfile: { id: string } | null };
};

export class AppointmentListingDto {
    @ApiProperty({ format: 'uuid' }) id: string;
    @ApiProperty() title: string;
    @ApiProperty() city: string;
    @ApiBrazilianState() state: string;
}

export class AppointmentInspectorDto {
    @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Id do perfil do avaliador (não é id de usuário)' })
    profileId: string | null;
    @ApiProperty() name: string;
}

export class AppointmentPersonDto {
    @ApiProperty() name: string;
}

/**
 * Campos comuns a todos os perfis: sem valores e sem ids de usuário. Cada
 * perfil tem sua classe (Seller, Buyer, Inspector), com o próprio from().
 */
export abstract class AppointmentBaseResponseDto {
    @ApiProperty({ format: 'uuid' }) id: string;
    @ApiProperty({ enum: AppointmentStatus }) status: AppointmentStatus;
    @ApiProperty({ type: AppointmentListingDto }) listing: AppointmentListingDto;
    @ApiProperty({ type: AppointmentInspectorDto }) inspector: AppointmentInspectorDto;
    @ApiProperty({ type: AppointmentPersonDto }) buyer: AppointmentPersonDto;
    @ApiProperty({ type: AppointmentPersonDto }) seller: AppointmentPersonDto;
    @ApiProperty() startsAt: Date;
    @ApiProperty() endsAt: Date;
    @ApiProperty({ nullable: true, type: Date, description: 'Prazo da etapa atual' }) expiresAt: Date | null;
    @ApiProperty({ nullable: true, type: String }) meetingAddress: string | null;
    @ApiProperty({ enum: AppointmentActor, nullable: true, description: 'Quem encerrou (recusa, cancelamento ou expiração)' })
    endedBy: AppointmentActor | null;
    @ApiProperty({ enum: ROUTE_ACTIONS, isArray: true, description: 'Ações que quem chama pode executar agora' })
    availableActions: AppointmentAction[];
    @ApiProperty() createdAt: Date;

    /** Copia campo a campo os dados comuns (sem valores) para o DTO informado. */
    protected static fillBase<T extends AppointmentBaseResponseDto>(
        dto: T,
        appointment: AppointmentWithRelations,
        role: Participant,
    ): T {
        dto.id = appointment.id;
        dto.status = appointment.status;
        dto.listing = {
            id: appointment.listing.id,
            title: appointment.listing.title,
            city: appointment.listing.city,
            state: appointment.listing.state,
        };
        dto.inspector = {
            profileId: appointment.inspector.inspectorProfile?.id ?? null,
            name: appointment.inspector.name,
        };
        dto.buyer = { name: appointment.buyer.name };
        dto.seller = { name: appointment.seller.name };
        dto.startsAt = appointment.startsAt;
        dto.endsAt = appointment.endsAt;
        dto.expiresAt = appointment.expiresAt;
        dto.meetingAddress = appointment.meetingAddress;
        dto.endedBy = appointment.endedBy;
        dto.availableActions = availableActions(role, appointment.status);
        dto.createdAt = appointment.createdAt;
        return dto;
    }
}

/** Resposta para o comprador: base + preço que ele paga. */
export class BuyerAppointmentResponseDto extends AppointmentBaseResponseDto {
    @ApiProperty({ enum: ['BUYER'] }) myRole: 'BUYER';
    @ApiProperty({ type: 'integer', description: 'Preço da avaliação em centavos' }) priceCents: number;

    static from(appointment: AppointmentWithRelations): BuyerAppointmentResponseDto {
        const dto = AppointmentBaseResponseDto.fillBase(new BuyerAppointmentResponseDto(), appointment, 'BUYER');
        dto.myRole = 'BUYER';
        dto.priceCents = appointment.priceCents;
        return dto;
    }
}

/** Resposta para o vendedor: só a base, sem nenhum valor. */
export class SellerAppointmentResponseDto extends AppointmentBaseResponseDto {
    @ApiProperty({ enum: ['SELLER'] }) myRole: 'SELLER';

    static from(appointment: AppointmentWithRelations): SellerAppointmentResponseDto {
        const dto = AppointmentBaseResponseDto.fillBase(new SellerAppointmentResponseDto(), appointment, 'SELLER');
        dto.myRole = 'SELLER';
        return dto;
    }
}

/** Resposta para o avaliador: base + preço, comissão e repasse congelados. */
export class InspectorAppointmentResponseDto extends AppointmentBaseResponseDto {
    @ApiProperty({ enum: ['INSPECTOR'] }) myRole: 'INSPECTOR';
    @ApiProperty({ type: 'integer', description: 'Preço pago pelo comprador, em centavos' }) priceCents: number;
    @ApiProperty({ type: 'integer', description: 'Comissão da plataforma em pontos-base, congelada na criação' }) platformFeeBps: number;
    @ApiProperty({ type: 'integer', description: 'Comissão da plataforma em centavos' }) platformFeeCents: number;
    @ApiProperty({ type: 'integer', description: 'Repasse ao avaliador em centavos (preço - comissão)' }) inspectorPayoutCents: number;

    static from(appointment: AppointmentWithRelations): InspectorAppointmentResponseDto {
        const dto = AppointmentBaseResponseDto.fillBase(new InspectorAppointmentResponseDto(), appointment, 'INSPECTOR');
        dto.myRole = 'INSPECTOR';
        dto.priceCents = appointment.priceCents;
        dto.platformFeeBps = appointment.platformFeeBps;
        dto.platformFeeCents = appointment.platformFeeCents;
        dto.inspectorPayoutCents = appointment.inspectorPayoutCents;
        return dto;
    }
}

/** União das respostas por perfil; o discriminador é `myRole`. */
export type AppointmentResponseDto =
    | BuyerAppointmentResponseDto
    | SellerAppointmentResponseDto
    | InspectorAppointmentResponseDto;

/** Monta a resposta do perfil de quem chama. O campo proibido não existe na resposta. */
export function appointmentResponseFor(
    role: Participant,
    appointment: AppointmentWithRelations,
): AppointmentResponseDto {
    switch (role) {
        case 'BUYER':
            return BuyerAppointmentResponseDto.from(appointment);
        case 'SELLER':
            return SellerAppointmentResponseDto.from(appointment);
        case 'INSPECTOR':
            return InspectorAppointmentResponseDto.from(appointment);
    }
}

/** Modelos que precisam de @ApiExtraModels para o oneOf aparecer no OpenAPI. */
export const APPOINTMENT_RESPONSE_MODELS = [
    BuyerAppointmentResponseDto,
    SellerAppointmentResponseDto,
    InspectorAppointmentResponseDto,
] as const;

/** Schema OpenAPI da resposta por perfil: oneOf com discriminador em myRole. */
export function appointmentResponseSchema() {
    return {
        oneOf: APPOINTMENT_RESPONSE_MODELS.map((model) => ({ $ref: getSchemaPath(model) })),
        discriminator: {
            propertyName: 'myRole',
            mapping: {
                BUYER: getSchemaPath(BuyerAppointmentResponseDto),
                SELLER: getSchemaPath(SellerAppointmentResponseDto),
                INSPECTOR: getSchemaPath(InspectorAppointmentResponseDto),
            },
        },
    };
}
