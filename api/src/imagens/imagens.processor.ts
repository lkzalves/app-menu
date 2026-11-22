import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventosService } from '../eventos/eventos.service.js';
import { DadosJobPrato, FILA_IMAGENS } from '../fila/fila.constants.js';
import { tratarLimite } from '../fila/limite-excedido.error.js';
import { ImagensService } from './imagens.service.js';

// Pixabay: 100 req/60 s. O limiter conta jobs (cada um faz 1 busca); 90 deixa margem
@Processor(FILA_IMAGENS, { limiter: { max: 90, duration: 60_000 } })
export class ImagensProcessor extends WorkerHost {
  private readonly logger = new Logger(ImagensProcessor.name);

  constructor(
    private readonly imagens: ImagensService,
    private readonly eventos: EventosService,
  ) {
    super();
  }

  async process(job: Job<DadosJobPrato>) {
    const { dishId, nome, idioma } = job.data;
    try {
      const achou = await this.imagens.garantirImagem(dishId, nome, idioma);
      if (achou) await this.eventos.publicar({ tipo: 'imagem', dishId });
      return achou;
    } catch (e) {
      return tratarLimite(this.worker, e); // 429: pausa a fila; outro erro: relança para o retry
    }
  }

  @OnWorkerEvent('failed')
  aoFalhar(job: Job<DadosJobPrato> | undefined, erro: Error) {
    this.logger.warn(
      `Imagem do prato ${job?.data.dishId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`,
    );
  }
}
