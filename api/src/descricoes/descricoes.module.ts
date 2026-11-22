import { Module } from '@nestjs/common';
import { EventosModule } from '../eventos/eventos.module.js';
import { FilaModule } from '../fila/fila.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DescricoesProcessor } from './descricoes.processor.js';
import { DescricoesService } from './descricoes.service.js';
import { WikipediaProvider } from './wikipedia.provider.js';

@Module({
  imports: [PrismaModule, FilaModule, EventosModule],
  // O processor é o worker da fila "descricoes"
  providers: [WikipediaProvider, DescricoesService, DescricoesProcessor],
  exports: [DescricoesService],
})
export class DescricoesModule {}
