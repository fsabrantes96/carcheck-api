import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateInspectorProfileDto } from './dto/create-inspector-profile.dto.js';
import { InspectorResponseDto } from './dto/inspector-response.dto.js';
import { UpdateInspectorProfileDto } from './dto/update-inspector-profile.dto.js';

@Injectable()
export class InspectorsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(
        userId: string,
        dto: CreateInspectorProfileDto,
    ): Promise<InspectorResponseDto> {
        const exists = await this.prisma.inspectorProfile.findUnique({
            where: { userId },
        });
        if (exists) throw new ConflictException('Você já possui perfil de avaliador');


        const profile = await this.prisma.$transaction(async (tx) => {
            const created = await tx.inspectorProfile.create({
                data: { ...dto, userId },
                include: { user: true },
            });
            await tx.user.update({
                where: { id: userId },
                data: { roles: { push: 'INSPECTOR' } },
            });
            return created;
        });

        return InspectorResponseDto.from(profile);
    }

    async findMine(userId: string): Promise<InspectorResponseDto> {
        const profile = await this.prisma.inspectorProfile.findUnique({
            where: { userId },
            include: { user: true },
        });
        if (!profile) throw new NotFoundException('Perfil de avaliador não encontrado');
        return InspectorResponseDto.from(profile);
    }

    async update(
        userId: string,
        dto: UpdateInspectorProfileDto,
    ): Promise<InspectorResponseDto> {
        const exists = await this.prisma.inspectorProfile.findUnique({
            where: { userId },
        });
        if (!exists) throw new NotFoundException('Perfil de avaliador não encontrado');

        const profile = await this.prisma.inspectorProfile.update({
            where: { userId },
            data: dto,
            include: { user: true },
        });
        return InspectorResponseDto.from(profile);
    }

    async findAllVerified(): Promise<InspectorResponseDto[]> {
        const profiles = await this.prisma.inspectorProfile.findMany({
            where: { verified: true },
            include: { user: true },
            orderBy: { createdAt: 'desc' },
        });
        return profiles.map((p) => InspectorResponseDto.from(p));
    }
}