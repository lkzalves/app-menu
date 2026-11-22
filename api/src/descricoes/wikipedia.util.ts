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

// Resumo da Wikipedia → texto curto: sem parênteses (pronúncia, grafias alternativas), até 300 caracteres
export function limparExtrato(texto: string): string {
  let t = texto;
  let anterior: string;
  do {
    anterior = t;
    t = t.replace(/\s*\([^()]*\)/g, ''); // de dentro para fora, para tratar parênteses aninhados
  } while (t !== anterior);
  t = t.replace(/\s+/g, ' ').trim();

  if (t.length <= TAMANHO_MAXIMO) return t;
  const corte = t.slice(0, TAMANHO_MAXIMO);
  const fimFrase = corte.lastIndexOf('. ');
  if (fimFrase >= 100) return corte.slice(0, fimFrase + 1); // prefere terminar numa frase inteira
  const ultimoEspaco = corte.lastIndexOf(' ');
  const semPalavraPartida = ultimoEspaco > 0 ? corte.slice(0, ultimoEspaco) : corte;
  return semPalavraPartida.replace(/[,;:]$/, '') + '…';
}
