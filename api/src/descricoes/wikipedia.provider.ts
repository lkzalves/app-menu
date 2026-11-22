import { Injectable } from '@nestjs/common';
import { LimiteExcedidoError } from '../fila/limite-excedido.error.js';
import {
  idiomaWikipedia,
  limparExtrato,
  variacoesSingular,
  variacoesTitulo,
} from './wikipedia.util.js';

// A Wikimedia pede um User-Agent que identifique o cliente. Genérico: sem dados pessoais
const USER_AGENT = 'app-menu/0.1 (projeto de estudo)';
const IDIOMA_DESCRICAO = 'pt'; // a descrição sempre sai em português
const ESPERA_PADRAO_S = 60;
const TAMANHO_INGREDIENTE = 160; // uma frase curta por ingrediente
const TITULOS_POR_CONSULTA = 20; // a API só devolve até 20 resumos (extracts) por consulta
const TITULOS_POR_CONSULTA_LINKS = 50; // links entre idiomas não têm esse limite; 50 é o máximo de títulos

export interface DescricaoEncontrada {
  texto: string;
  url: string; // artigo em português, para o crédito (CC BY-SA 4.0)
}

export interface DescricaoIngrediente extends DescricaoEncontrada {
  nomePt: string; // título do artigo em português ("Tomate")
}

interface PaginaWiki {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  pageprops?: { disambiguation?: string };
  langlinks?: { lang: string; title: string }[];
  extract?: string;
}

interface ConsultaWiki {
  pages?: PaginaWiki[];
  normalized?: { from: string; to: string }[];
  redirects?: { from: string; to: string }[];
}

interface RespostaWiki {
  error?: { code: string };
  query?: ConsultaWiki;
}

const unicos = (lista: string[]) => [...new Set(lista)];

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

    return { texto, url: this.urlPt(pagina) };
  }

  // Descrição curta de vários ingredientes de uma vez (chave = o nome pedido). Em geral 2 consultas
  // para o item inteiro, em vez de 2 por ingrediente. Por nome tenta, em ordem: o nome (e o singular,
  // para "pomodori") na wiki do idioma do cardápio → link para pt; e, se não achar, o título direto
  // na wiki pt (o cardápio pode estar em italiano e a linha de ingredientes em português)
  async buscarVarios(nomes: string[], idioma: string): Promise<Map<string, DescricaoIngrediente>> {
    const achados = new Map<string, DescricaoIngrediente>();
    if (!nomes.length) return achados;

    // A Wikipedia põe a 1ª letra em maiúscula sozinha ("pomodoro" = "Pomodoro"): não gasta título à toa
    const maiuscula = (t: string) => t.charAt(0).toLocaleUpperCase() + t.slice(1);
    const candidatos = (nome: string, wiki: string) =>
      unicos(
        [...variacoesTitulo(nome), ...variacoesSingular(nome, wiki).flatMap(variacoesTitulo)].map(maiuscula),
      );

    // Passo 1: nome → títulos a tentar na wiki pt
    const titulosPt = new Map<string, string[]>();
    const wiki = idiomaWikipedia(idioma);
    if (wiki && wiki !== IDIOMA_DESCRICAO) {
      const porNome = nomes.map((nome) => ({ nome, titulos: candidatos(nome, wiki) }));
      const origem = await this.consultarEmLotes(
        wiki,
        porNome.flatMap((p) => p.titulos),
        { prop: 'langlinks|pageprops', lllang: IDIOMA_DESCRICAO, lllimit: 'max' },
        TITULOS_POR_CONSULTA_LINKS,
      );
      for (const { nome, titulos } of porNome) {
        for (const titulo of titulos) {
          const link = this.resolver(origem, titulo)?.langlinks?.[0]?.title;
          if (link) {
            titulosPt.set(nome, [link]);
            break;
          }
        }
      }
    }
    for (const nome of nomes) {
      if (!titulosPt.has(nome)) titulosPt.set(nome, candidatos(nome, IDIOMA_DESCRICAO));
    }

    // Passo 2: o resumo em português de todos
    const pt = await this.consultarEmLotes(IDIOMA_DESCRICAO, unicos([...titulosPt.values()].flat()), {
      prop: 'extracts|pageprops',
      exintro: '1',
      explaintext: '1',
      exsentences: '1',
      exlimit: String(TITULOS_POR_CONSULTA),
    });
    for (const nome of nomes) {
      for (const titulo of titulosPt.get(nome) ?? []) {
        const pagina = this.resolver(pt, titulo);
        const texto = limparExtrato(pagina?.extract ?? '', TAMANHO_INGREDIENTE);
        if (pagina && texto) {
          achados.set(nome, { nomePt: pagina.title, texto, url: this.urlPt(pagina) });
          break;
        }
      }
    }
    return achados;
  }

  private urlPt(pagina: PaginaWiki) {
    const caminho = encodeURIComponent(pagina.title.replace(/ /g, '_'));
    return `https://${IDIOMA_DESCRICAO}.wikipedia.org/wiki/${caminho}`;
  }

  // Consulta os títulos de uma vez e devolve a primeira página (na ordem pedida) que existe
  // e não é página de desambiguação
  private async lerPagina(
    wiki: string,
    titulos: string[],
    extras: Record<string, string>,
  ): Promise<PaginaWiki | null> {
    const query = await this.consultar(wiki, titulos, extras);
    for (const pedido of titulos) {
      const pagina = this.resolver(query, pedido);
      if (pagina) return pagina;
    }
    return null;
  }

  // Muitos títulos: divide em consultas de TITULOS_POR_CONSULTA e junta as respostas
  private async consultarEmLotes(
    wiki: string,
    titulos: string[],
    extras: Record<string, string>,
    porConsulta = TITULOS_POR_CONSULTA,
  ): Promise<ConsultaWiki> {
    const junto: ConsultaWiki = { pages: [], normalized: [], redirects: [] };
    for (let i = 0; i < titulos.length; i += porConsulta) {
      const parte = await this.consultar(wiki, titulos.slice(i, i + porConsulta), extras);
      junto.pages!.push(...(parte.pages ?? []));
      junto.normalized!.push(...(parte.normalized ?? []));
      junto.redirects!.push(...(parte.redirects ?? []));
    }
    return junto;
  }

  private async consultar(
    wiki: string,
    titulos: string[],
    extras: Record<string, string>,
  ): Promise<ConsultaWiki> {
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
    return corpo.query ?? {};
  }

  // O título pedido → a página que a API devolveu para ele, se existe e não é desambiguação.
  // Faz o mesmo caminho que a API: normaliza o título e segue os redirects
  private resolver(query: ConsultaWiki, pedido: string): PaginaWiki | null {
    if (!query.pages) return null;
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
    return null;
  }
}
