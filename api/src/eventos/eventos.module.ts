import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { EventosController } from './eventos.controller.js';
import { EventosService } from './eventos.service.js';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [EventosController],
  providers: [EventosService],
  exports: [EventosService], // os workers publicam por aqui
})
export class EventosModule {}
