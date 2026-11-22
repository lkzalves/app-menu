import { normalizarNome } from '../catalogo/normalizar-nome.util.js';

export const MAX_INGREDIENTES = 15;
// Lixo nas pontas ("|", "—", "*"), a mesma regra de limparNomePrato
const LIXO_NAS_PONTAS = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const TAMANHO_MAXIMO = 60;

// Separadores entre ingredientes: pontuação e conectivos (pt/it/es/en). "com/con/with" também separa:
// "Creme de Queijo com Laranja" → "Creme de Queijo", "Laranja"
const PONTUACAO = /[,;•·/|+&]/u;
const CONECTIVOS = /\s+(?:e|ed|y|and|com|con|with)\s+/iu;
// Preposição que sobra no início de um pedaço ("de pesca artesanal" → "pesca artesanal")
const PREPOSICAO_INICIAL = /^(?:de|di|da|do|del|della|com|con|with|al|alla|ao|à|em|in)\s+/iu;

// Texto cru do OCR das linhas de ingredientes → lista de ingredientes, na ordem do cardápio
export function separarIngredientes(texto: string): string[] {
  const corrido = texto
    .replace(/-\s*\n\s*/g, '') // palavra hifenizada na quebra de linha: "pro-\ndução" → "produção"
    .replace(/\s+/g, ' ')
    .replace(/\([^()]*\)/g, ' ') // "(purê de berinjelas)", "(IT)", "(2 un.)"
    .replace(/\S*\d\S*/g, ' '); // preço, peso e número de alérgeno: "R$37", "250g", "1,7"

  const vistos = new Set<string>();
  const ingredientes: string[] = [];
  for (const pedaco of corrido.split(PONTUACAO).flatMap((p) => p.split(CONECTIVOS))) {
    let nome = pedaco.replace(/\s+/g, ' ').replace(LIXO_NAS_PONTAS, '');
    while (PREPOSICAO_INICIAL.test(nome)) nome = nome.replace(PREPOSICAO_INICIAL, '');
    nome = nome.slice(0, TAMANHO_MAXIMO).replace(LIXO_NAS_PONTAS, '');

    // Pelo menos 2 letras: descarta restos do OCR ("|", "a", "—")
    const chave = normalizarNome(nome);
    if ((chave.match(/\p{L}/gu) ?? []).length < 2 || vistos.has(chave)) continue;
    vistos.add(chave);
    ingredientes.push(nome);
    if (ingredientes.length === MAX_INGREDIENTES) break;
  }
  return ingredientes;
}
