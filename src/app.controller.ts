import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Rota de boas-vindas (texto puro), fora do contrato OpenAPI.
  @Get()
  @ApiExcludeEndpoint()
  getHello(): string {
    return this.appService.getHello();
  }
}
