import { LimiteExcedidoError } from '../fila/limite-excedido.error.js';
import { WikipediaProvider } from './wikipedia.provider.js';

// Resposta da API de consulta (formatversion=2)
const api = (query: object, init: ResponseInit = {}) =>
  new Response(JSON.stringify({ query }), { status: 200, ...init });

const consultaUrl = (fetchMock: ReturnType<typeof vi.fn>, chamada: number) =>
  new URL(String(fetchMock.mock.calls[chamada][0]));

describe('WikipediaProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: WikipediaProvider;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    provider = new WikipediaProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acha o artigo no idioma do cardápio, segue o link para pt e devolve o resumo limpo', async () => {
    fetchMock
      .mockResolvedValueOnce(
        api({ pages: [{ title: 'Tiramisù', langlinks: [{ lang: 'pt', title: 'Tiramisù' }] }] }),
      )
      .mockResolvedValueOnce(
        api({ pages: [{ title: 'Tiramisù', extract: 'O tiramisu (do italiano: tiramisù) é uma sobremesa italiana.' }] }),
      );

    const r = await provider.buscar('TIRAMISÙ', 'it');

    expect(r).toEqual({
      texto: 'O tiramisu é uma sobremesa italiana.',
      url: 'https://pt.wikipedia.org/wiki/Tiramis%C3%B9',
    });
    const [primeira, segunda] = [consultaUrl(fetchMock, 0), consultaUrl(fetchMock, 1)];
    expect(primeira.host).toBe('it.wikipedia.org');
    expect(primeira.searchParams.get('titles')).toBe('Tiramisù');
    expect(primeira.searchParams.get('lllang')).toBe('pt');
    expect(primeira.searchParams.get('redirects')).toBe('1');
    expect(segunda.host).toBe('pt.wikipedia.org');
    expect(segunda.searchParams.get('exintro')).toBe('1');
    expect(segunda.searchParams.get('explaintext')).toBe('1');
  });

  it('cardápio em português vai direto à wiki pt, numa chamada só', async () => {
    fetchMock.mockResolvedValue(api({ pages: [{ title: 'Moqueca', extract: 'A moqueca é um cozido de peixe.' }] }));

    const r = await provider.buscar('Moqueca', 'pt-BR');

    expect(r?.texto).toBe('A moqueca é um cozido de peixe.');
    expect(r?.url).toBe('https://pt.wikipedia.org/wiki/Moqueca');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sem versão em português, não há descrição (e não consulta a wiki pt)', async () => {
    fetchMock.mockResolvedValue(api({ pages: [{ title: 'Frittata di pasta' }] }));
    expect(await provider.buscar('Frittata di pasta', 'it')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('título que não existe: null', async () => {
    fetchMock.mockResolvedValue(api({ pages: [{ title: 'Pizza Bomba', missing: true }] }));
    expect(await provider.buscar('Pizza Bomba', 'it')).toBeNull();
  });

  it('página de desambiguação: null', async () => {
    fetchMock.mockResolvedValue(
      api({ pages: [{ title: 'Margherita', pageprops: { disambiguation: '' }, langlinks: [{ lang: 'pt', title: 'Margarida' }] }] }),
    );
    expect(await provider.buscar('Margherita', 'it')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('usa a primeira grafia que existe (o OCR lê em maiúsculas)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        api({
          pages: [
            { title: 'Pizza margherita', missing: true },
            { title: 'Pizza Margherita', langlinks: [{ lang: 'pt', title: 'Pizza margherita' }] },
          ],
        }),
      )
      .mockResolvedValueOnce(api({ pages: [{ title: 'Pizza margherita', extract: 'A pizza margherita é clássica.' }] }));

    const r = await provider.buscar('PIZZA MARGHERITA', 'it');

    expect(consultaUrl(fetchMock, 0).searchParams.get('titles')).toBe('Pizza margherita|Pizza Margherita');
    expect(r?.texto).toBe('A pizza margherita é clássica.');
  });

  it('segue redirect ("Tacos al pastor" → "Taco al pastor")', async () => {
    fetchMock
      .mockResolvedValueOnce(
        api({
          redirects: [{ from: 'Tacos al pastor', to: 'Taco al pastor' }],
          pages: [{ title: 'Taco al pastor', langlinks: [{ lang: 'pt', title: 'Al pastor' }] }],
        }),
      )
      .mockResolvedValueOnce(api({ pages: [{ title: 'Al pastor', extract: 'Al pastor é um prato mexicano.' }] }));

    const r = await provider.buscar('Tacos al pastor', 'es');

    expect(r?.url).toBe('https://pt.wikipedia.org/wiki/Al_pastor');
  });

  it('idioma indeterminado ou inválido, ou nome vazio: null sem consultar a API', async () => {
    expect(await provider.buscar('Tiramisù', 'und')).toBeNull();
    expect(await provider.buscar('Tiramisù', 'it.evil.com/')).toBeNull();
    expect(await provider.buscar('  ', 'it')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resumo vazio no artigo pt: null', async () => {
    fetchMock.mockResolvedValue(api({ pages: [{ title: 'Moqueca', extract: ' () ' }] }));
    expect(await provider.buscar('Moqueca', 'pt')).toBeNull();
  });

  it('identifica o cliente no User-Agent, sem dados pessoais', async () => {
    fetchMock.mockResolvedValue(api({ pages: [] }));
    await provider.buscar('Tiramisù', 'it');
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { 'User-Agent': 'app-menu/0.1 (projeto de estudo)' } });
  });

  it('erro HTTP lança (para o chamador tentar de novo depois); 429 vira LimiteExcedidoError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(provider.buscar('Tiramisù', 'it')).rejects.toThrow('Wikipedia respondeu HTTP 500');

    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    await expect(provider.buscar('Tiramisù', 'it')).rejects.toBeInstanceOf(LimiteExcedidoError);
  });

  it('429 usa o Retry-After (segundos) como espera, ou 60 s se o header faltar', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '21' } }));
    await expect(provider.buscar('Tiramisù', 'it')).rejects.toMatchObject({ esperaMs: 21_000 });

    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    await expect(provider.buscar('Tiramisù', 'it')).rejects.toMatchObject({ esperaMs: 60_000 });
  });

  it('erro dentro do JSON da API também lança', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'badvalue' } }), { status: 200 }));
    await expect(provider.buscar('Tiramisù', 'it')).rejects.toThrow('badvalue');
  });
});
