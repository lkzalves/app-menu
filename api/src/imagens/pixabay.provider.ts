import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { semArtigo } from '../catalogo/normalizar-nome.util.js';
import { ImageProvider, ImagemEncontrada } from './image.provider.js';
import { idiomaPixabay, tagsCombinam } from './pixabay.util.js';

const URL_API = 'https://pixabay.com/api/';
const CACHE_MS = 24 * 60 * 60 * 1000; // a Pixabay exige cache de 24 h
const ESPERA_PADRAO_S = 60; // janela do limite de 100 req/60 s

interface PixabayHit {
  pageURL: string;
  tags: string;
  webformatURL: string;
  user: string;
}

@Injectable()
export class PixabayProvider extends ImageProvider {
  private readonly chave: string;
  // Respostas por consulta+idioma (inclusive as vazias). Fica na memória: some se a API reiniciar
  private readonly cache = new Map<string, { expira: number; hits: PixabayHit[] }>();
  private bloqueadoAte = 0; // timestamp até quando o limite de requisições está esgotado

  constructor(config: ConfigService) {
    super();
    this.chave = config.getOrThrow<string>('PIXABAY_API_KEY');
  }

  async buscar(nome: string, idioma: string): Promise<ImagemEncontrada | null> {
    const lang = idiomaPixabay(idioma);
    const q = semArtigo(nome).slice(0, 100); // a Pixabay aceita até 100 caracteres
    if (!q) return null;

    const hits = await this.consultar(q, lang);
    const hit = hits.find((h) => tagsCombinam(h.tags, nome));
    if (!hit) return null;

    return {
      fonte: 'PIXABAY',
      urlDownload: hit.webformatURL,
      paginaOrigem: hit.pageURL,
      credito: hit.user,
      licenca: 'Pixabay Content License',
    };
  }

  private async consultar(q: string, lang: string): Promise<PixabayHit[]> {
    const chaveCache = `${lang}|${q.toLowerCase()}`; // sem a chave da API
    const guardado = this.cache.get(chaveCache);
    if (guardado && guardado.expira > Date.now()) return guardado.hits;

    if (Date.now() < this.bloqueadoAte) this.lancarLimite();

    const url = new URL(URL_API);
    url.search = new URLSearchParams({
      key: this.chave,
      q,
      lang,
      image_type: 'photo',
      category: 'food',
      safesearch: 'true',
      per_page: '20',
    }).toString();

    const resposta = await fetch(url);
    this.registrarLimite(resposta);
    if (resposta.status === 429) this.lancarLimite();
    // Mensagem sem a URL: ela leva a chave
    if (!resposta.ok) throw new Error(`Pixabay respondeu HTTP ${resposta.status}`);

    const corpo = (await resposta.json()) as { hits?: PixabayHit[] };
    const hits = corpo.hits ?? [];
    this.cache.set(chaveCache, { expira: Date.now() + CACHE_MS, hits });
    return hits;
  }

  // Lê os headers de limite: se não sobrou requisição, bloqueia até a janela resetar
  private registrarLimite(resposta: Response) {
    const restantes = resposta.headers.get('X-RateLimit-Remaining');
    const reset = Number(resposta.headers.get('X-RateLimit-Reset')) || ESPERA_PADRAO_S;
    if (resposta.status === 429 || restantes === '0') {
      this.bloqueadoAte = Date.now() + reset * 1000;
    }
  }

  private lancarLimite(): never {
    throw new HttpException(
      'Limite de requisições da Pixabay atingido; tente novamente em instantes',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
