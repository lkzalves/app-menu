import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { MenusModule } from './menus/menus.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  // ConfigModule global: lê o .env e deixa ConfigService injetável em qualquer lugar
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MenusModule],
  controllers: [AppController],
  providers: [
    AppService,
    // Pipe global registrado como provider: vale na app e também nos testes e2e
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true, // descarta campos fora do DTO
        forbidNonWhitelisted: true, // e responde 400 se vierem campos extras
        transform: true, // converte o JSON em instância do DTO (e aplica @Transform)
      }),
    },
  ],
})
export class AppModule {}
