import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';

// Espera as filas esvaziarem (nada esperando, rodando ou adiado). Como os jobs são removidos ao
// terminar, "vazia" quer dizer "tudo processado"
export async function aguardarFila(
  app: INestApplication,
  nomes: string[],
  limiteMs = 15_000,
) {
  const filas = nomes.map((n) => app.get<Queue>(getQueueToken(n)));
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    const contagens = await Promise.all(
      filas.map((f) =>
        f.getJobCounts('waiting', 'active', 'delayed', 'prioritized'),
      ),
    );
    if (contagens.every((c) => Object.values(c).every((n) => n === 0))) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Fila(s) ${nomes.join(', ')} não esvaziou em ${limiteMs} ms`);
}

// Apaga as chaves das três filas deste app de teste (o prefixo é só dele), inclusive o "meta" que
// toda fila registrada cria, mesmo a que o teste não usou
export async function limparFilas(app: INestApplication) {
  for (const n of ['ocr', 'imagens', 'descricoes']) {
    await app.get<Queue>(getQueueToken(n)).obliterate({ force: true });
  }
}

// Prefixo novo a cada execução: o teste nunca herda jobs nem contador do limiter de outra execução.
// (Limpar as chaves no início com obliterate corre com a inicialização do worker e o deixa surdo)
export const prefixoUnico = (base: string) =>
  `${base}-${Date.now().toString(36)}`;
