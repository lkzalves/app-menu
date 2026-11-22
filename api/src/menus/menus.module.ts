import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MenusController } from './menus.controller.js';
import { MenusService } from './menus.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [MenusController],
  providers: [MenusService],
})
export class MenusModule {}
