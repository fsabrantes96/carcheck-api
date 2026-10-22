import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) { }

  @Post('register')
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.auth.register(dto);
  }
}