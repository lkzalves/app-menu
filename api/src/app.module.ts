import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { MenusModule } from './menus/menus.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  // ConfigModule global: lê o .env e deixa ConfigService injetável em qualquer lugar
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MenusModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
