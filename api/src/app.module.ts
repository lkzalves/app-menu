import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { LocalDisk, StorageModule } from '@nestjs/storage';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DescricoesModule } from './descricoes/descricoes.module.js';
import { FilaModule } from './fila/fila.module.js';
import { ImagensModule } from './imagens/imagens.module.js';
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
    // Conexão única com o Redis para todas as filas (forRoot só aqui, no módulo raiz)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: { host: redis.hostname, port: Number(redis.port) || 6379 },
          prefix: config.get<string>('REDIS_PREFIX') ?? 'bull',
        };
      },
    }),
    FilaModule,
    PrismaModule,
    MenusModule,
    ImagensModule, // GET /imagens/:id e o worker de fotos
    DescricoesModule, // o worker de descrições
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
