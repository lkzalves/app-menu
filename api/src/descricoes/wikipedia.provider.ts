import { Injectable } from '@nestjs/common';
import { LimiteExcedidoError } from '../fila/limite-excedido.error.js';
import { idiomaWikipedia, limparExtrato, variacoesTitulo } from './wikipedia.util.js';

// A Wikimedia pede um User-Agent que identifique o cliente. Genérico: sem dados pessoais
const USER_AGENT = 'app-menu/0.1 (projeto de estudo)';
const IDIOMA_DESCRICAO = 'pt'; // a descrição sempre sai em português
const ESPERA_PADRAO_S = 60;

export interface DescricaoEncontrada {
  texto: string;
  url: string; // artigo em português, para o crédito (CC BY-SA 4.0)
}

interface PaginaWiki {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  pageprops?: { disambiguation?: string };
  langlinks?: { lang: string; title: string }[];
  extract?: string;
}

interface RespostaWiki {
  error?: { code: string };
  query?: {
    pages?: PaginaWiki[];
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
  };
}

@Injectable()
export class WikipediaProvider {
  // Acha o prato pelo TÍTULO exato (com redirects) na wiki do idioma do cardápio e devolve o resumo
  // da versão em português. Sem artigo, ou sem versão em português, devolve null.
  // Busca por texto foi descartada: para pratos autorais devolve artigos de outras coisas.
  async buscar(nome: string, idioma: string): Promise<DescricaoEncontrada | null> {
    const wiki = idiomaWikipedia(idioma);
    const titulos = variacoesTitulo(nome);
    if (!wiki || !titulos.length) return null;

    let artigoPt: string;
    if (wiki === IDIOMA_DESCRICAO) {
      artigoPt = titulos.join('|');
    } else {
      // Passo 1: o artigo no idioma do cardápio e o link dele para a versão em português
      const origem = await this.lerPagina(wiki, titulos, { prop: 'langlinks|pageprops', lllang: IDIOMA_DESCRICAO });
      const link = origem?.langlinks?.[0]?.title;
      if (!link) return null;
      artigoPt = link;
    }

    // Passo 2: o resumo em português
    const pagina = await this.lerPagina(
      IDIOMA_DESCRICAO,
      artigoPt.split('|'),
      { prop: 'extracts|pageprops', exintro: '1', explaintext: '1', exsentences: '2' },
    );
    const texto = limparExtrato(pagina?.extract ?? '');
    if (!pagina || !texto) return null;

    const caminho = encodeURIComponent(pagina.title.replace(/ /g, '_'));
    return { texto, url: `https://${IDIOMA_DESCRICAO}.wikipedia.org/wiki/${caminho}` };
  }

  // Consulta os títulos de uma vez e devolve a primeira página (na ordem pedida) que existe
  // e não é página de desambiguação
  private async lerPagina(
    wiki: string,
    titulos: string[],
    extras: Record<string, string>,
  ): Promise<PaginaWiki | null> {
    const url = new URL(`https://${wiki}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      redirects: '1',
      ppprop: 'disambiguation',
      titles: titulos.join('|'),
      ...extras,
    }).toString();

    const resposta = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (resposta.status === 429) {
      // Retry-After vem em segundos (~21 s na prática); sem o header, espera 60 s
      const segundos = Number(resposta.headers.get('Retry-After')) || ESPERA_PADRAO_S;
      throw new LimiteExcedidoError('Wikipedia', segundos * 1000);
    }
    if (!resposta.ok) throw new Error(`Wikipedia respondeu HTTP ${resposta.status}`);

    const corpo = (await resposta.json()) as RespostaWiki;
    if (corpo.error) throw new Error(`Wikipedia devolveu erro: ${corpo.error.code}`);
    const query = corpo.query;
    if (!query?.pages) return null;

    for (const pedido of titulos) {
      // Mesmo caminho que a API fez: normaliza o título e segue os redirects
      let titulo = query.normalized?.find((n) => n.from === pedido)?.to ?? pedido;
      for (let i = 0; i < 5; i++) {
        const destino = query.redirects?.find((r) => r.from === titulo)?.to;
        if (!destino) break;
        titulo = destino;
      }
      const pagina = query.pages.find((p) => p.title === titulo);
      if (pagina && !pagina.missing && !pagina.invalid && pagina.pageprops?.disambiguation === undefined) {
        return pagina;
      }
    }
    return null;
  }
}
