import { semArtigo } from '../catalogo/normalizar-nome.util.js';

const TAMANHO_MAXIMO = 300;

// Menu.idioma → subdomínio da Wikipedia ("it" → it.wikipedia.org). Aceita "pt-BR".
// Só 2–3 letras minúsculas: o valor vira parte do host, então nada além disso passa. "und" = indeterminado
export function idiomaWikipedia(idioma: string | null | undefined): string | null {
  const base = (idioma ?? '').toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(base) && base !== 'und' ? base : null;
}

// Títulos da Wikipedia diferenciam maiúsculas ("Pizza Margherita" × "Pizza margherita") e o OCR costuma
// ler o cardápio todo em maiúsculas. Devolve as grafias a tentar, em ordem de preferência
export function variacoesTitulo(nome: string): string[] {
  const base = semArtigo(nome)
    .normalize('NFC') // a API avisa quando o texto não está em NFC
    .replace(/[|#<>[\]{}]/g, ' ') // caracteres que não valem em título
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return [];

  const minusculo = base.toLocaleLowerCase();
  const frase = minusculo.charAt(0).toLocaleUpperCase() + minusculo.slice(1);
  const titulo = minusculo.replace(/(^|\s)(\p{L})/gu, (_, espaco: string, letra: string) => espaco + letra.toLocaleUpperCase());
  const tudoMaiusculo = base === base.toLocaleUpperCase() && base !== minusculo;

  // O nome como veio só entra se não estiver todo em maiúsculas (aí não é um título válido)
  const candidatos = tudoMaiusculo ? [frase, titulo] : [base, frase, titulo];
  return [...new Set(candidatos)];
}

// Plural → singular, por idioma: [fim da palavra, troca]. Só palpites; a busca tenta todos e vale o
// primeiro título que existir
const REGRAS_SINGULAR: Record<string, [RegExp, string][]> = {
  it: [[/che$/, 'ca'], [/ghe$/, 'ga'], [/chi$/, 'co'], [/ghi$/, 'go'], [/i$/, 'o'], [/i$/, 'e'], [/i$/, 'io'], [/e$/, 'a']],
  es: [[/es$/, ''], [/s$/, '']],
  pt: [[/ões$/, 'ão'], [/ães$/, 'ão'], [/es$/, ''], [/s$/, '']],
  en: [[/ies$/, 'y'], [/oes$/, 'o'], [/es$/, ''], [/s$/, '']],
};

// Ingrediente de uma palavra no plural ("pomodori", "melanzane") → formas no singular a tentar
// (o título do artigo costuma estar no singular). Mais de uma palavra ou palavra curta: nenhuma
export function variacoesSingular(nome: string, idioma: string): string[] {
  const palavra = nome.trim().toLocaleLowerCase();
  const regras = REGRAS_SINGULAR[idiomaWikipedia(idioma) ?? ''];
  if (!regras || palavra.length < 4 || /\s/.test(palavra)) return [];

  const formas = regras.filter(([fim]) => fim.test(palavra)).map(([fim, troca]) => palavra.replace(fim, troca));
  return [...new Set(formas)].filter((f) => f !== palavra && f.length >= 3);
}

// Resumo da Wikipedia → texto curto: sem parênteses (pronúncia, grafias alternativas), até `tamanho` caracteres
export function limparExtrato(texto: string, tamanho = TAMANHO_MAXIMO): string {
  let t = texto;
  let anterior: string;
  do {
    anterior = t;
    t = t.replace(/\s*\([^()]*\)/g, ''); // de dentro para fora, para tratar parênteses aninhados
  } while (t !== anterior);
  t = t.replace(/\s+/g, ' ').trim();

  if (t.length <= tamanho) return t;
  const corte = t.slice(0, tamanho);
  const fimFrase = corte.lastIndexOf('. ');
  if (fimFrase >= tamanho / 3) return corte.slice(0, fimFrase + 1); // prefere terminar numa frase inteira
  const ultimoEspaco = corte.lastIndexOf(' ');
  const semPalavraPartida = ultimoEspaco > 0 ? corte.slice(0, ultimoEspaco) : corte;
  return semPalavraPartida.replace(/[,;:]$/, '') + '…';
}
