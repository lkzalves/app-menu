import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventosService } from '../eventos/eventos.service.js';
import { DadosJobPrato, FILA_DESCRICOES } from '../fila/fila.constants.js';
import { tratarLimite } from '../fila/limite-excedido.error.js';
import { DescricoesService } from './descricoes.service.js';

// Wikipedia anônima: ~40 req em poucos minutos já dá 429 e cada job faz até 2 requisições.
// O limiter evita chegar lá; se chegar, o Retry-After pausa a fila (ver tratarLimite)
@Processor(FILA_DESCRICOES, { limiter: { max: 15, duration: 60_000 } })
export class DescricoesProcessor extends WorkerHost {
  private readonly logger = new Logger(DescricoesProcessor.name);

  constructor(
    private readonly descricoes: DescricoesService,
    private readonly eventos: EventosService,
  ) {
    super();
  }

  async process(job: Job<DadosJobPrato>) {
    const { dishId, nome, idioma } = job.data;
    try {
      const achou = await this.descricoes.garantirDescricao(
        dishId,
        nome,
        idioma,
      );
      if (achou) await this.eventos.publicar({ tipo: 'descricao', dishId });
      return achou;
    } catch (e) {
      return tratarLimite(this.worker, e);
    }
  }

  @OnWorkerEvent('failed')
  aoFalhar(job: Job<DadosJobPrato> | undefined, erro: Error) {
    this.logger.warn(
      `Descrição do prato ${job?.data.dishId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`,
    );
  }
}
