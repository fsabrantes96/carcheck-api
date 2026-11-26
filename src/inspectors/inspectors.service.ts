import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PageQueryDto } from '../common/dto/page-query.dto.js';
import { ErrorCode, withCode } from '../common/errors/error-code.js';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma/prisma-errors.js';
import { BUSINESS_RULES } from '../config/business-rules.js';
import type { BusinessRules } from '../config/business-rules.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateInspectorProfileDto } from './dto/create-inspector-profile.dto.js';
import { InspectorResponseDto } from './dto/inspector-response.dto.js';
import { MyInspectorProfileResponseDto } from './dto/my-inspector-profile-response.dto.js';
import type { PaginatedInspectorsResponseDto } from './dto/paginated-inspectors-response.dto.js';
import { UpdateInspectorProfileDto } from './dto/update-inspector-profile.dto.js';

/** Desempate por id: sem ele, perfis com o mesmo createdAt repetem ou somem entre páginas. */
const STABLE_ORDER: Prisma.InspectorProfileOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

@Injectable()
export class InspectorsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BUSINESS_RULES) private readonly rules: BusinessRules,
  ) {}

  async create(
    userId: string,
    dto: CreateInspectorProfileDto,
  ): Promise<InspectorResponseDto> {
    this.assertMinimumPrice(dto.basePriceCents);
    const exists = await this.prisma.inspectorProfile.findUnique({
      where: { userId },
    });
    if (exists)
      throw new ConflictException(
        withCode(
          ErrorCode.INSPECTOR_PROFILE_EXISTS,
          'Você já possui perfil de avaliador',
        ),
      );

    let profile;
    try {
      profile = await this.prisma.$transaction(async (tx) => {
        const created = await tx.inspectorProfile.create({
          data: {
            bio: dto.bio,
            specialties: dto.specialties,
            city: dto.city,
            state: dto.state,
            serviceRadiusKm: dto.serviceRadiusKm,
            basePriceCents: dto.basePriceCents,
            userId,
          },
          include: { user: true },
        });
        await tx.user.update({
          where: { id: userId },
          data: { roles: { push: 'INSPECTOR' } },
        });
        return created;
      });
    } catch (error) {
      // Corrida: outra requisição criou o perfil depois da checagem.
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictException(
          withCode(
            ErrorCode.INSPECTOR_PROFILE_EXISTS,
            'Você já possui perfil de avaliador',
          ),
        );
      }
      throw error;
    }

    return InspectorResponseDto.from(profile);
  }

  async findMine(userId: string): Promise<MyInspectorProfileResponseDto> {
    const profile = await this.prisma.inspectorProfile.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!profile)
      throw new NotFoundException(
        withCode(
          ErrorCode.INSPECTOR_PROFILE_NOT_FOUND,
          'Perfil de avaliador não encontrado',
        ),
      );
    return MyInspectorProfileResponseDto.fromOwnProfile(
      profile,
      this.rules.platformFeeBps,
    );
  }

  async update(
    userId: string,
    dto: UpdateInspectorProfileDto,
  ): Promise<InspectorResponseDto> {
    // Só confere o preço quando ele vem no corpo: um perfil antigo abaixo do
    // mínimo continua editável nos outros campos.
    if (dto.basePriceCents !== undefined)
      this.assertMinimumPrice(dto.basePriceCents);
    const exists = await this.prisma.inspectorProfile.findUnique({
      where: { userId },
    });
    if (!exists)
      throw new NotFoundException(
        withCode(
          ErrorCode.INSPECTOR_PROFILE_NOT_FOUND,
          'Perfil de avaliador não encontrado',
        ),
      );

    // Campo a campo: só o que o DTO declara chega ao Prisma. Campos ausentes
    // ficam undefined, e o Prisma não os altera (update parcial).
    const profile = await this.prisma.inspectorProfile.update({
      where: { userId },
      data: {
        bio: dto.bio,
        specialties: dto.specialties,
        city: dto.city,
        state: dto.state,
        serviceRadiusKm: dto.serviceRadiusKm,
        basePriceCents: dto.basePriceCents,
      },
      include: { user: true },
    });
    return InspectorResponseDto.from(profile);
  }

  async findAllVerified(
    query: PageQueryDto,
  ): Promise<PaginatedInspectorsResponseDto> {
    const { page, limit } = query;
    const where: Prisma.InspectorProfileWhereInput = { verified: true };

    const [profiles, total] = await this.prisma.$transaction([
      this.prisma.inspectorProfile.findMany({
        where,
        include: { user: true },
        orderBy: STABLE_ORDER,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inspectorProfile.count({ where }),
    ]);

    return {
      items: profiles.map((p) => InspectorResponseDto.from(p)),
      total,
      page,
      limit,
    };
  }

  /** 400 se o preço base estiver abaixo de MIN_INSPECTION_PRICE_CENTS. */
  private assertMinimumPrice(basePriceCents: number): void {
    const min = this.rules.minInspectionPriceCents;
    if (basePriceCents < min) {
      const reais = (min / 100).toFixed(2).replace('.', ',');
      throw new BadRequestException(
        withCode(
          ErrorCode.PRICE_BELOW_MINIMUM,
          `O preço base precisa ser de pelo menos ${min} centavos (R$ ${reais})`,
        ),
      );
    }
  }
}
