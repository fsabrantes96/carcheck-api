import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { ErrorCode, withCode } from '../common/errors/error-code.js';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentUserResponseDto } from './dto/current-user-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { INVALID_TOKEN_MESSAGE } from './jwt-auth.guard.js';
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
    if (exists) throw new ConflictException(withCode(ErrorCode.EMAIL_ALREADY_REGISTERED, 'E-mail já cadastrado'));

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let user;
    try {
      user = await this.prisma.user.create({
        data: { name: dto.name, email: dto.email, passwordHash },
      });
    } catch (error) {
      // Corrida: outra requisição criou o mesmo e-mail depois da checagem.
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictException(withCode(ErrorCode.EMAIL_ALREADY_REGISTERED, 'E-mail já cadastrado'));
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
      throw new UnauthorizedException(withCode(ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha inválidos'));
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException(withCode(ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha inválidos'));
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload);

    return { accessToken, user: UserResponseDto.from(user) };
  }

  async me(userId: string): Promise<CurrentUserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // Token válido de uma conta que não existe mais: para o cliente é o mesmo
    // caso de um token inválido (precisa entrar de novo), como no RolesGuard.
    if (!user) {
      throw new UnauthorizedException(withCode(ErrorCode.UNAUTHENTICATED, INVALID_TOKEN_MESSAGE));
    }
    return CurrentUserResponseDto.fromUser(user);
  }
}
