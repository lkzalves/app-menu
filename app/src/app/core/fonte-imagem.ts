import { FonteImagem } from './menus-api.service';

const NOMES: Record<FonteImagem, string> = {
  PIXABAY: 'Pixabay',
  WIKIMEDIA: 'Wikimedia',
  BRAVE: 'Brave',
};

// Nome da fonte para o crédito da foto
export const nomeDaFonte = (fonte: FonteImagem) => NOMES[fonte] ?? fonte;
