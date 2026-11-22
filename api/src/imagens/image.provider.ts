import type { FonteImagem } from '../generated/prisma/enums.js';

// O que uma fonte devolve: onde baixar a foto e os dados para o crédito
export interface ImagemEncontrada {
  fonte: FonteImagem;
  urlDownload: string; // só para baixar para o nosso storage; nunca é exibida (hotlink proibido)
  paginaOrigem: string;
  credito: string;
  licenca: string;
}

// Token da lista de fontes, na ordem em que são tentadas (ImageProvider[])
export const IMAGE_PROVIDERS = Symbol('IMAGE_PROVIDERS');

// Classe abstrata pelo mesmo motivo do OcrProvider: serve de token de injeção.
// Cada fonte (Pixabay, Wikidata, Brave...) estende esta classe.
export abstract class ImageProvider {
  // Devolve a melhor foto para o prato naquele idioma, ou null se a fonte não tiver nada confiável
  abstract buscar(nome: string, idioma: string): Promise<ImagemEncontrada | null>;
}
