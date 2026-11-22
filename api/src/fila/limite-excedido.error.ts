import { Worker } from 'bullmq';

// Lançado pelos providers quando a fonte externa pede para esperar (HTTP 429)
export class LimiteExcedidoError extends Error {
  constructor(
    readonly fonte: string,
    readonly esperaMs: number,
  ) {
    super(
      `Limite de requisições de ${fonte} atingido; nova tentativa em ${Math.ceil(esperaMs / 1000)} s`,
    );
  }
}

// Usado pelos processors: limite da fonte pausa a fila inteira pelo tempo pedido e devolve o job
// sem gastar tentativa. Qualquer outro erro é relançado e entra no retry normal (attempts/backoff)
export async function tratarLimite(
  worker: Pick<Worker, 'rateLimit'>,
  erro: unknown,
): Promise<never> {
  if (erro instanceof LimiteExcedidoError) {
    await worker.rateLimit(erro.esperaMs);
    throw Worker.RateLimitError();
  }
  throw erro;
}
