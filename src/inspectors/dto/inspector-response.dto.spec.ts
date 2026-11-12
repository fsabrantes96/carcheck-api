import { InspectorResponseDto } from './inspector-response.dto.js';
import { MyInspectorProfileResponseDto } from './my-inspector-profile-response.dto.js';

const profile = {
  id: 'p1',
  userId: 'u1',
  bio: 'Mecânico há 15 anos, especialista em câmbio.',
  specialties: ['ENGINE' as const],
  city: 'Barretos',
  state: 'SP',
  serviceRadiusKm: 30,
  basePriceCents: 15000,
  verified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: { id: 'u1', name: 'João', email: 'joao@x.com', passwordHash: 'hash' },
};

const PUBLIC_KEYS = [
  'basePriceCents',
  'bio',
  'city',
  'id',
  'name',
  'serviceRadiusKm',
  'specialties',
  'state',
  'verified',
];

describe('InspectorResponseDto (lista pública)', () => {
  it('tem exatamente os campos públicos, sem comissão nem repasse', () => {
    expect(Object.keys(InspectorResponseDto.from(profile)).sort()).toEqual(PUBLIC_KEYS);
  });
});

describe('MyInspectorProfileResponseDto (GET /inspectors/me)', () => {
  it('tem os campos públicos mais platformFeeBps e estimatedPayoutCents', () => {
    const dto = MyInspectorProfileResponseDto.fromOwnProfile(profile, 1000);

    expect(dto).toBeInstanceOf(MyInspectorProfileResponseDto);
    expect(Object.keys(dto).sort()).toEqual(
      [...PUBLIC_KEYS, 'estimatedPayoutCents', 'platformFeeBps'].sort(),
    );
  });

  it('calcula o repasse estimado com splitPlatformFee (15000 com 1000 bps = 13500)', () => {
    const dto = MyInspectorProfileResponseDto.fromOwnProfile(profile, 1000);

    expect(dto.platformFeeBps).toBe(1000);
    expect(dto.estimatedPayoutCents).toBe(13500);
  });

  it('não expõe userId nem dados sensíveis do usuário', () => {
    const json = JSON.stringify(MyInspectorProfileResponseDto.fromOwnProfile(profile, 1000));

    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain('joao@x.com');
    expect(json).not.toContain('"u1"');
  });
});
