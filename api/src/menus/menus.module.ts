import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module.js';
import { DescricoesModule } from '../descricoes/descricoes.module.js';
import { ImagensModule } from '../imagens/imagens.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MenusController } from './menus.controller.js';
import { MenusService } from './menus.service.js';

@Module({
  imports: [PrismaModule, OcrModule, CatalogoModule, ImagensModule, DescricoesModule],
  controllers: [MenusController],
  providers: [MenusService],
})
export class MenusModule {}
