import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import type { JwtPayload } from './types/jwt-payload.js';

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService,) { }

    async register(dto: RegisterDto): Promise<UserResponseDto> {
        const exists = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (exists) throw new ConflictException('E-mail já cadastrado');

        const passwordHash = await bcrypt.hash(dto.password, 10);
        const user = await this.prisma.user.create({
            data: { name: dto.name, email: dto.email, passwordHash },
        });

        return UserResponseDto.from(user);
    }

    async login(dto: LoginDto): Promise<LoginResponseDto> {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        const passwordOk = user
            ? await bcrypt.compare(dto.password, user.passwordHash)
            : false;

        if (!user || !passwordOk) {
            throw new UnauthorizedException('E-mail ou senha inválidos');
        }

        const payload: JwtPayload = { sub: user.id, email: user.email };
        const accessToken = await this.jwt.signAsync(payload);

        return { accessToken, user: UserResponseDto.from(user) };
    }

    async me(userId: string): Promise<UserResponseDto> {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');
        return UserResponseDto.from(user);
    }
}