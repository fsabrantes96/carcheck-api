import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import {
  ApiBodyErrorResponses,
  ApiCommonErrorResponses,
  UNAUTHORIZED_DESCRIPTION,
} from '../common/swagger/api-responses.js';
import {
  AUTH_THROTTLE,
  THROTTLE_ERROR_MESSAGE,
} from '../common/throttler/throttler.config.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { JwtPayload } from './types/jwt-payload.js';

@ApiTags('auth')
@ApiCommonErrorResponses()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) { }

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: `${THROTTLE_ERROR_MESSAGE} (5 por minuto por IP)`,
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos (lista em errors) ou corpo malformado' })
  @ApiBodyErrorResponses()
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'E-mail já cadastrado' })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: `${THROTTLE_ERROR_MESSAGE} (5 por minuto por IP)`,
  })
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos (lista em errors) ou corpo malformado' })
  @ApiBodyErrorResponses()
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'E-mail ou senha inválidos' })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_DESCRIPTION })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Usuário não encontrado (token válido de uma conta que não existe mais)' })
  me(@CurrentUser() user: JwtPayload): Promise<UserResponseDto> {
    return this.auth.me(user.sub);
  }
}
