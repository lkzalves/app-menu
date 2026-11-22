import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FILA_DESCRICOES, FILA_IMAGENS, FILA_OCR } from './fila.constants.js';

// Registra as filas; quem precisa enfileirar importa este módulo e injeta com @InjectQueue(nome).
// A conexão com o Redis é única e fica no AppModule (BullModule.forRootAsync)
const filas = BullModule.registerQueue(
  { name: FILA_OCR },
  { name: FILA_IMAGENS },
  { name: FILA_DESCRICOES },
);

@Module({ imports: [filas], exports: [filas] })
export class FilaModule {}
