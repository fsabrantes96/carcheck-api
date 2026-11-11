import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import type { JwtPayload } from './types/jwt-payload.js';

const BCRYPT_ROUNDS = 10;

/**
 * Hash fixo, com o mesmo custo do hash real, usado no login quando o e-mail
 * não existe: o bcrypt.compare roda do mesmo jeito e o tempo de resposta não
 * revela se o e-mail está cadastrado.
 */
const DUMMY_HASH = bcrypt.hashSync('carcheck-dummy-password', BCRYPT_ROUNDS);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('E-mail já cadastrado');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let user;
    try {
      user = await this.prisma.user.create({
        data: { name: dto.name, email: dto.email, passwordHash },
      });
    } catch (error) {
      // Corrida: outra requisição criou o mesmo e-mail depois da checagem.
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictException('E-mail já cadastrado');
      }
      throw error;
    }

    return UserResponseDto.from(user);
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // Tempo constante: compara com o hash fixo e descarta o resultado.
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
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
