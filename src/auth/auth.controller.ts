import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
  ApiOperationId,
  throttleDescription,
  UNAUTHORIZED_OR_DELETED_ACCOUNT_DESCRIPTION,
} from '../common/swagger/api-responses.js';
import { AUTH_THROTTLE } from '../common/throttler/throttler.config.js';
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
  @ApiOperationId('registerUser')
  @Throttle(AUTH_THROTTLE)
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: throttleDescription(AUTH_THROTTLE.default.limit),
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Dados inválidos (lista em errors) ou corpo malformado' })
  @ApiBodyErrorResponses()
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'E-mail já cadastrado' })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @ApiOperationId('login')
  @Throttle(AUTH_THROTTLE)
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: throttleDescription(AUTH_THROTTLE.default.limit),
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
  @ApiOperationId('getCurrentUser')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: UNAUTHORIZED_OR_DELETED_ACCOUNT_DESCRIPTION })
  me(@CurrentUser() user: JwtPayload): Promise<UserResponseDto> {
    return this.auth.me(user.sub);
  }
}
