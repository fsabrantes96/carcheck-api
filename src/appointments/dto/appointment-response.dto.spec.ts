import {
  appointmentResponseFor,
  appointmentResponseSchema,
  BuyerAppointmentResponseDto,
  InspectorAppointmentResponseDto,
  SellerAppointmentResponseDto,
} from './appointment-response.dto.js';
import type { AppointmentWithRelations } from './appointment-response.dto.js';

/** Entidade como o Prisma devolve, com ids de usuário que nunca podem sair. */
const entity = {
  id: 'a1',
  listingId: 'l1',
  buyerId: 'user-buyer',
  sellerId: 'user-seller',
  inspectorUserId: 'user-inspector',
  status: 'ACCEPTED',
  startsAt: new Date('2030-01-03T12:00:00.000Z'),
  endsAt: new Date('2030-01-03T13:00:00.000Z'),
  expiresAt: new Date('2030-01-02T12:00:00.000Z'),
  meetingAddress: null,
  priceCents: 15000,
  platformFeeBps: 1000,
  platformFeeCents: 1500,
  inspectorPayoutCents: 13500,
  acceptedAt: new Date('2030-01-01T13:00:00.000Z'),
  confirmedAt: null,
  endedAt: null,
  endedBy: null,
  createdAt: new Date('2030-01-01T12:00:00.000Z'),
  updatedAt: new Date('2030-01-01T13:00:00.000Z'),
  listing: { id: 'l1', title: 'Gol 1.0 2018', city: 'Boituva', state: 'SP' },
  buyer: { name: 'Bruno' },
  seller: { name: 'Vera' },
  inspector: { name: 'Ivo', inspectorProfile: { id: 'p1' } },
} as AppointmentWithRelations;

const BASE_KEYS = [
  'availableActions',
  'buyer',
  'createdAt',
  'endedBy',
  'endsAt',
  'expiresAt',
  'id',
  'inspector',
  'listing',
  'meetingAddress',
  'myRole',
  'seller',
  'startsAt',
  'status',
];

function keys(value: object): string[] {
  return Object.keys(value).sort();
}

describe('respostas do agendamento por perfil', () => {
  it('Seller: exatamente a base (sem priceCents nem nenhum valor)', () => {
    const dto = SellerAppointmentResponseDto.from(entity);

    expect(keys(dto)).toEqual([...BASE_KEYS].sort());
    expect(dto).not.toHaveProperty('priceCents');
    expect(dto.myRole).toBe('SELLER');
  });

  it('Buyer: base + priceCents (sem platformFeeBps, platformFeeCents nem inspectorPayoutCents)', () => {
    const dto = BuyerAppointmentResponseDto.from(entity);

    expect(keys(dto)).toEqual([...BASE_KEYS, 'priceCents'].sort());
    expect(dto).not.toHaveProperty('platformFeeCents');
    expect(dto).not.toHaveProperty('inspectorPayoutCents');
    expect(dto).not.toHaveProperty('platformFeeBps');
    expect(dto).toMatchObject({ myRole: 'BUYER', priceCents: 15000 });
  });

  it('Inspector: base + preço, comissão em bps, comissão e repasse', () => {
    const dto = InspectorAppointmentResponseDto.from(entity);

    expect(keys(dto)).toEqual(
      [...BASE_KEYS, 'priceCents', 'platformFeeBps', 'platformFeeCents', 'inspectorPayoutCents'].sort(),
    );
    expect(dto).toMatchObject({
      myRole: 'INSPECTOR',
      priceCents: 15000,
      platformFeeBps: 1000,
      platformFeeCents: 1500,
      inspectorPayoutCents: 13500,
    });
  });

  it.each([
    ['Seller', SellerAppointmentResponseDto.from(entity)],
    ['Buyer', BuyerAppointmentResponseDto.from(entity)],
    ['Inspector', InspectorAppointmentResponseDto.from(entity)],
  ])('%s: nenhum id de usuário na resposta', (_label, dto) => {
    const json = JSON.stringify(dto);

    expect(json).not.toContain('user-buyer');
    expect(json).not.toContain('user-seller');
    expect(json).not.toContain('user-inspector');
  });

  it('a base copia anúncio, nomes, horários e o id do perfil do avaliador', () => {
    const dto = SellerAppointmentResponseDto.from(entity);

    expect(dto).toMatchObject({
      id: 'a1',
      status: 'ACCEPTED',
      listing: { id: 'l1', title: 'Gol 1.0 2018', city: 'Boituva', state: 'SP' },
      inspector: { profileId: 'p1', name: 'Ivo' },
      buyer: { name: 'Bruno' },
      seller: { name: 'Vera' },
      startsAt: entity.startsAt,
      endsAt: entity.endsAt,
      expiresAt: entity.expiresAt,
      meetingAddress: null,
      endedBy: null,
    });
    expect(keys(dto.listing)).toEqual(['city', 'id', 'state', 'title']);
    expect(keys(dto.inspector)).toEqual(['name', 'profileId']);
    expect(keys(dto.buyer)).toEqual(['name']);
  });

  it('availableActions depende do papel (ACCEPTED: vendedor confirma ou cancela; avaliador só cancela)', () => {
    expect(SellerAppointmentResponseDto.from(entity).availableActions.sort()).toEqual(['CANCEL', 'CONFIRM']);
    expect(InspectorAppointmentResponseDto.from(entity).availableActions).toEqual(['CANCEL']);
  });

  it.each([
    ['BUYER', BuyerAppointmentResponseDto],
    ['SELLER', SellerAppointmentResponseDto],
    ['INSPECTOR', InspectorAppointmentResponseDto],
  ] as const)('appointmentResponseFor(%s) devolve o DTO do perfil', (role, type) => {
    expect(appointmentResponseFor(role, entity)).toBeInstanceOf(type);
  });

  it('o schema OpenAPI é oneOf das três respostas com discriminador em myRole', () => {
    const schema = appointmentResponseSchema();

    expect(schema.oneOf).toEqual([
      { $ref: '#/components/schemas/BuyerAppointmentResponseDto' },
      { $ref: '#/components/schemas/SellerAppointmentResponseDto' },
      { $ref: '#/components/schemas/InspectorAppointmentResponseDto' },
    ]);
    expect(schema.discriminator).toEqual({
      propertyName: 'myRole',
      mapping: {
        BUYER: '#/components/schemas/BuyerAppointmentResponseDto',
        SELLER: '#/components/schemas/SellerAppointmentResponseDto',
        INSPECTOR: '#/components/schemas/InspectorAppointmentResponseDto',
      },
    });
  });
});
