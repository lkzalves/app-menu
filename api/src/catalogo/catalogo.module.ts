import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CatalogoService } from './catalogo.service.js';

@Module({
  imports: [PrismaModule],
  providers: [CatalogoService],
  exports: [CatalogoService], // o MenusModule vai importar este módulo no 5.3
})
export class CatalogoModule {}
