import { normalizarNome } from '../catalogo/normalizar-nome.util.js';

// Os 26 idiomas que o parâmetro `lang` da Pixabay aceita
const IDIOMAS_PIXABAY = new Set([
  'cs', 'da', 'de', 'en', 'es', 'fr', 'id', 'it', 'hu', 'nl', 'no', 'pl', 'pt',
  'ro', 'sk', 'fi', 'sv', 'tr', 'vi', 'th', 'bg', 'ru', 'el', 'ja', 'ko', 'zh',
]);

// Menu.idioma → `lang` da Pixabay. Aceita "pt-BR"; o que não for aceito (inclusive "und") vira "en"
export function idiomaPixabay(idioma: string | null | undefined): string {
  const base = (idioma ?? '').toLowerCase().split(/[-_]/)[0];
  return IDIOMAS_PIXABAY.has(base) ? base : 'en';
}

// A Pixabay não dá nota de relevância e erra pratos autorais. Só confiamos no resultado
// se alguma tag contém uma palavra do nome do prato (palavras com 3+ letras, para "di"/"al" não casarem tudo)
export function tagsCombinam(tags: string, nomePrato: string): boolean {
  const palavras = normalizarNome(nomePrato)
    .split(' ')
    .filter((p) => p.length >= 3);
  const listaTags = tags.split(',').map((t) => normalizarNome(t));
  return palavras.some((p) => listaTags.some((t) => t.includes(p)));
}
