import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { LocalDisk, StorageModule } from '@nestjs/storage';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { MenusModule } from './menus/menus.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  // ConfigModule global: lê o .env e deixa ConfigService injetável em qualquer lugar
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Disco "fotos": pasta local no dev. Para R2/S3 só trocamos LocalDisk por S3Disk aqui
    StorageModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        default: 'fotos',
        disks: {
          fotos: new LocalDisk({ root: config.getOrThrow<string>('STORAGE_ROOT') }),
        },
      }),
    }),
    PrismaModule,
    MenusModule,
  ],
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
