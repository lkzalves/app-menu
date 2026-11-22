import type { FonteImagem } from '../generated/prisma/enums.js';

// O que uma fonte devolve: onde baixar a foto e os dados para o crédito
export interface ImagemEncontrada {
  fonte: FonteImagem;
  urlDownload: string; // só para baixar para o nosso storage; nunca é exibida (hotlink proibido)
  paginaOrigem: string;
  credito: string;
  licenca: string;
}

export interface OpcoesBusca {
  ignorar: ReadonlySet<string>; // urlDownload que não podem voltar
  limite: number; // quantas fotos no máximo
}

// Token da lista de fontes, na ordem em que são tentadas (ImageProvider[])
export const IMAGE_PROVIDERS = Symbol('IMAGE_PROVIDERS');

// Classe abstrata pelo mesmo motivo do OcrProvider: serve de token de injeção.
// Cada fonte (Pixabay, Wikidata, Brave...) estende esta classe.
export abstract class ImageProvider {
  // Devolve até `limite` fotos para o prato naquele idioma, da melhor para a pior, ou [] se a fonte não
  // tiver nada confiável. Nunca devolve uma urlDownload que esteja em `ignorar` (fotos que o prato já
  // tem ou que o cliente rejeitou com "não é esse prato")
  abstract buscar(nome: string, idioma: string, opcoes: OpcoesBusca): Promise<ImagemEncontrada[]>;
}
