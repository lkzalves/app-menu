import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { semArtigo } from '../catalogo/normalizar-nome.util.js';
import { LimiteExcedidoError } from '../fila/limite-excedido.error.js';
import { RedisService } from '../redis/redis.service.js';
import { ImageProvider, ImagemEncontrada } from './image.provider.js';
import { idiomaPixabay, tagsCombinam } from './pixabay.util.js';

const URL_API = 'https://pixabay.com/api/';
const CACHE_SEGUNDOS = 24 * 60 * 60; // a Pixabay exige cache de 24 h
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
  private readonly prefixoCache: string;
  private bloqueadoAte = 0; // timestamp até quando o limite de requisições está esgotado

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    super();
    this.chave = config.getOrThrow<string>('PIXABAY_API_KEY');
    this.prefixoCache = `${config.get<string>('REDIS_PREFIX') ?? 'bull'}:pixabay:`;
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
    // Respostas por consulta+idioma (inclusive as vazias) ficam no Redis por 24 h: sobrevivem a
    // reinício e valem para todos os processos. A chave nunca leva a chave da API
    const chaveCache = `${this.prefixoCache}${lang}|${q.toLowerCase()}`;
    const guardado = await this.redis.get(chaveCache);
    if (guardado) return JSON.parse(guardado) as PixabayHit[];

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
    if (!resposta.ok)
      throw new Error(`Pixabay respondeu HTTP ${resposta.status}`);

    const corpo = (await resposta.json()) as { hits?: PixabayHit[] };
    const hits = corpo.hits ?? [];
    await this.redis.set(
      chaveCache,
      JSON.stringify(hits),
      'EX',
      CACHE_SEGUNDOS,
    );
    return hits;
  }

  // Lê os headers de limite: se não sobrou requisição, bloqueia até a janela resetar
  private registrarLimite(resposta: Response) {
    const restantes = resposta.headers.get('X-RateLimit-Remaining');
    const reset =
      Number(resposta.headers.get('X-RateLimit-Reset')) || ESPERA_PADRAO_S;
    if (resposta.status === 429 || restantes === '0') {
      this.bloqueadoAte = Date.now() + reset * 1000;
    }
  }

  // O worker espera este tempo antes de tentar de novo (mínimo de 1 s)
  private lancarLimite(): never {
    throw new LimiteExcedidoError(
      'Pixabay',
      Math.max(this.bloqueadoAte - Date.now(), 1000),
    );
  }
}
