import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DescricoesService } from './descricoes.service.js';
import { WikipediaProvider } from './wikipedia.provider.js';

@Module({
  imports: [PrismaModule],
  providers: [WikipediaProvider, DescricoesService],
  exports: [DescricoesService],
})
export class DescricoesModule {}
