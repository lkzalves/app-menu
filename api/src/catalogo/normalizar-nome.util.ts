// Artigos que o cardápio põe na frente do nome e que não ajudam a identificar o prato
// (it: il lo la le i gli; es: el los las; pt: o os as; en: the). O "l" cobre "L'insalata".
const ARTIGOS = new Set(['il', 'lo', 'la', 'le', 'i', 'gli', 'l', 'el', 'los', 'las', 'o', 'os', 'as', 'the']);

// Tira só o artigo do início, mantendo acentos e maiúsculas ("L'Insalata" → "Insalata").
// Serve para buscar em fontes externas, onde o acento ajuda ("açaí").
export function semArtigo(nome: string): string {
  const limpo = nome.trim().replace(/\s+/g, ' ');
  const m = limpo.match(/^(\p{L}+)(?:['’]|\s)\s*(.+)$/u);
  return m && ARTIGOS.has(m[1].toLowerCase()) ? m[2] : limpo;
}

// Nome do prato → forma comparável: minúsculas, sem acento, sem pontuação e sem artigo no início.
// Usada para gravar e para buscar, então "LE Melanzane" e "melanzane" viram a mesma coisa.
export function normalizarNome(nome: string): string {
  const palavras = nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // tira os acentos separados pelo NFD
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // pontuação e símbolos viram espaço
    .trim()
    .split(' ')
    .filter(Boolean);

  // Só tira o artigo se sobrar alguma coisa ("LE" sozinho continua "le")
  if (palavras.length > 1 && ARTIGOS.has(palavras[0])) palavras.shift();
  return palavras.join(' ');
}
