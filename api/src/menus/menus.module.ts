import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module.js';
import { EventosModule } from '../eventos/eventos.module.js';
import { FilaModule } from '../fila/fila.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MenusController } from './menus.controller.js';
import { MenusService } from './menus.service.js';
import { OcrProcessor } from './ocr.processor.js';

@Module({
  imports: [PrismaModule, OcrModule, CatalogoModule, FilaModule, EventosModule],
  controllers: [MenusController],
  providers: [MenusService, OcrProcessor], // OcrProcessor = worker da fila "ocr"
})
export class MenusModule {}
