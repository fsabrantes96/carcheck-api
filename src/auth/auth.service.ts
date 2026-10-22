import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService) { }

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
}