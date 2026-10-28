import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InspectorsController } from './inspectors.controller.js';
import { InspectorsService } from './inspectors.service.js';

@Module({
    imports: [AuthModule],
    controllers: [InspectorsController],
    providers: [InspectorsService],
})
export class InspectorsModule { }