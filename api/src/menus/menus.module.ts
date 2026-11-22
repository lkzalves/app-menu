import { Module } from '@nestjs/common';
import { OcrModule } from '../ocr/ocr.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MenusController } from './menus.controller.js';
import { MenusService } from './menus.service.js';

@Module({
  imports: [PrismaModule, OcrModule],
  controllers: [MenusController],
  providers: [MenusService],
})
export class MenusModule {}
