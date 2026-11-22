import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventosService } from '../eventos/eventos.service.js';
import {
  DadosJobDescricao,
  DadosJobIngredientes,
  DadosJobPrato,
  FILA_DESCRICOES,
} from '../fila/fila.constants.js';
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

  // Dois tipos de job na mesma fila, para o limite da Wikipedia valer para os dois: 'ingredientes'
  // (todos os ingredientes de um item) e 'buscar' (a descrição de um prato)
  async process(job: Job<DadosJobDescricao>) {
    if (job.name === 'ingredientes') return this.processarIngredientes(job.data as DadosJobIngredientes);

    const { dishId, nome, idioma } = job.data as DadosJobPrato;
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

  private async processarIngredientes({ itemId }: DadosJobIngredientes) {
    try {
      const menuId = await this.descricoes.garantirIngredientes(itemId);
      if (menuId) await this.eventos.publicar({ tipo: 'ingrediente', menuId });
      return menuId !== null;
    } catch (e) {
      return tratarLimite(this.worker, e);
    }
  }

  @OnWorkerEvent('failed')
  aoFalhar(job: Job<DadosJobDescricao> | undefined, erro: Error) {
    if (!job) return;
    const alvo =
      job.name === 'ingredientes'
        ? `dos ingredientes do item ${(job.data as DadosJobIngredientes).itemId}`
        : `do prato ${(job.data as DadosJobPrato).dishId}`;
    this.logger.warn(`Descrição ${alvo} falhou (tentativa ${job.attemptsMade}): ${erro.message}`);
  }
}
