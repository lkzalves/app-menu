// Nomes das filas no Redis (uma por gargalo: CPU do OCR, limite da Pixabay, limite da Wikipedia)
export const FILA_OCR = 'ocr';
export const FILA_IMAGENS = 'imagens';
export const FILA_DESCRICOES = 'descricoes';

// Dados de um job por prato (filas imagens e descricoes)
export interface DadosJobPrato {
  dishId: string;
  nome: string;
  idioma: string;
}

// removeOnComplete/removeOnFail liberam o jobId: o BullMQ ignora job novo com o id de um job que
// ainda está guardado, e aqui pedir de novo tem que funcionar (os services são idempotentes).
// Erro de rede/5xx: 3 tentativas com espera crescente
export const OPCOES_JOB_PRATO = {
  removeOnComplete: true,
  removeOnFail: true,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
} as const;

// Job da fila descricoes que busca a descrição de TODOS os ingredientes de um item (1 job por prato
// do cardápio; a Wikipedia aceita vários títulos por consulta). O idioma vem do menu do item
export interface DadosJobIngredientes {
  itemId: string;
}

// A fila descricoes tem dois tipos de job, separados por job.name: 'buscar' (prato) e 'ingredientes'
export type DadosJobDescricao = DadosJobPrato | DadosJobIngredientes;

export const jobIngredientes = (itemId: string) => ({
  name: 'ingredientes',
  data: { itemId },
  opts: { ...OPCOES_JOB_PRATO, jobId: `ingredientes-${itemId}` },
});

// Dados de um job de OCR: um recorte (MenuItem) por job
export interface DadosJobOcr {
  itemId: string;
}

// Jobs de foto/descrição de pratos, com id fixo por prato (dedup). Usado por quem enfileira:
// o endpoint de reprocessar e o worker de OCR
export const jobsDePratos = (
  tipo: 'imagem' | 'descricao',
  pratos: DadosJobPrato[],
) =>
  pratos.map((p) => ({
    name: 'buscar',
    data: p,
    opts: { ...OPCOES_JOB_PRATO, jobId: `${tipo}-${p.dishId}` },
  }));
