import type { ConfigService } from '@nestjs/config';
import { LimiteExcedidoError } from '../fila/limite-excedido.error.js';
import type { OpcoesBusca } from './image.provider.js';
import { PixabayProvider } from './pixabay.provider.js';

const hit = (tags: string) => ({
  pageURL: 'https://pixabay.com/photos/x-1/',
  tags,
  webformatURL: 'https://pixabay.com/get/x_640.jpg',
  user: 'fotografo',
});

const resposta = (hits: unknown[], init: ResponseInit = {}) =>
  new Response(JSON.stringify({ hits }), { status: 200, ...init });

describe('PixabayProvider', () => {
  const buscar = (nome: string, idioma: string, opcoes: Partial<OpcoesBusca> = {}) =>
    provider.buscar(nome, idioma, { ignorar: new Set(), limite: 3, ...opcoes });
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: PixabayProvider;
  // Redis falso em memória: só o que o provider usa (get e set)
  let guardado: Map<string, string>;
  let redis: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      getOrThrow: () => 'chave-falsa',
      get: () => undefined, // sem REDIS_PREFIX: o prefixo cai no padrão "bull"
    } as unknown as ConfigService;
    guardado = new Map();
    redis = {
      get: vi.fn(async (k: string) => guardado.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => void guardado.set(k, v)),
    };
    provider = new PixabayProvider(config, redis as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('monta a consulta com idioma do cardápio, categoria food e nome sem artigo', async () => {
    fetchMock.mockResolvedValue(resposta([]));
    await buscar('Il Tiramisù', 'it');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('q')).toBe('Tiramisù');
    expect(url.searchParams.get('lang')).toBe('it');
    expect(url.searchParams.get('image_type')).toBe('photo');
    expect(url.searchParams.get('category')).toBe('food');
    expect(url.searchParams.get('safesearch')).toBe('true');
    expect(url.searchParams.get('key')).toBe('chave-falsa');
  });

  it('usa "en" quando o idioma não é aceito', async () => {
    fetchMock.mockResolvedValue(resposta([]));
    await buscar('Ramen', 'und');
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('lang'),
    ).toBe('en');
  });

  it('devolve os resultados cujas tags combinam, com fonte e crédito', async () => {
    fetchMock.mockResolvedValue(resposta([hit('sunset, beach'), hit('tiramisu, dessert')]));
    const r = await buscar('Tiramisù', 'it');
    expect(r).toEqual([
      {
        fonte: 'PIXABAY',
        urlDownload: 'https://pixabay.com/get/x_640.jpg',
        paginaOrigem: 'https://pixabay.com/photos/x-1/',
        credito: 'fotografo',
        licenca: 'Pixabay Content License',
      },
    ]);
  });

  it('limite: devolve só as primeiras que combinam, na ordem da Pixabay', async () => {
    const hits = ['a', 'b', 'c', 'd', 'e'].map((x) => ({
      ...hit('tiramisu'),
      webformatURL: `https://pixabay.com/get/${x}_640.jpg`,
    }));
    fetchMock.mockResolvedValue(resposta(hits));

    const r = await buscar('Tiramisù', 'it', { limite: 3 });
    expect(r.map((i) => i.urlDownload)).toEqual([
      'https://pixabay.com/get/a_640.jpg',
      'https://pixabay.com/get/b_640.jpg',
      'https://pixabay.com/get/c_640.jpg',
    ]);
  });

  it('com menos resultados que o limite, devolve só os que existem', async () => {
    fetchMock.mockResolvedValue(resposta([hit('tiramisu'), hit('sunset')]));
    expect(await buscar('Tiramisù', 'it', { limite: 3 })).toHaveLength(1);
  });

  it('ignorar: pula as fotos já usadas ou rejeitadas e completa com as seguintes', async () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => ({
      ...hit('tiramisu'),
      webformatURL: `https://pixabay.com/get/${x}_640.jpg`,
    }));
    fetchMock.mockResolvedValue(resposta([a, b, c, d]));

    const r = await buscar('Tiramisù', 'it', {
      ignorar: new Set([a.webformatURL, c.webformatURL]),
      limite: 2,
    });
    expect(r.map((i) => i.urlDownload)).toEqual([b.webformatURL, d.webformatURL]);
  });

  it('ignorar: se todas as que combinam foram usadas ou rejeitadas, devolve lista vazia', async () => {
    const unica = { ...hit('tiramisu'), webformatURL: 'https://pixabay.com/get/a_640.jpg' };
    fetchMock.mockResolvedValue(resposta([unica]));

    expect(await buscar('Tiramisù', 'it', { ignorar: new Set([unica.webformatURL]) })).toEqual([]);
  });

  it('devolve lista vazia quando nenhuma tag combina', async () => {
    fetchMock.mockResolvedValue(resposta([hit('sunset, beach')]));
    expect(await buscar('Tiramisù', 'it')).toEqual([]);
  });

  it('cache: a mesma consulta não vai de novo à Pixabay, nem quando não achou nada', async () => {
    fetchMock.mockResolvedValue(resposta([]));
    await buscar('Tiramisù', 'it');
    await buscar('Il Tiramisù', 'it'); // mesma consulta depois de tirar o artigo
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cache separa por idioma', async () => {
    fetchMock.mockImplementation(async () => resposta([]));
    await buscar('Tiramisù', 'it');
    await buscar('Tiramisù', 'pt');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('guarda a resposta no Redis por 24 h, com chave sem a chave da API', async () => {
    fetchMock.mockResolvedValue(resposta([hit('tiramisu')]));
    await buscar('Tiramisù', 'it');

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [chave, valor, modo, segundos] = redis.set.mock.calls[0];
    expect(chave).toBe('bull:pixabay:it|tiramisù');
    expect(chave).not.toContain('chave-falsa');
    expect(JSON.parse(valor)).toHaveLength(1);
    expect([modo, segundos]).toEqual(['EX', 24 * 60 * 60]);
  });

  it('cache já no Redis (de outro processo ou de antes do reinício): não chama a Pixabay', async () => {
    guardado.set('bull:pixabay:it|tiramisù', JSON.stringify([hit('tiramisu')]));

    expect(await buscar('Tiramisù', 'it')).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limite esgotado: responde o que veio, mas a próxima consulta lança LimiteExcedidoError sem chamar a API', async () => {
    fetchMock.mockResolvedValue(
      resposta([hit('tiramisu')], {
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '30' },
      }),
    );
    expect(await buscar('Tiramisù', 'it')).toHaveLength(1);

    await expect(buscar('Pizza', 'it')).rejects.toBeInstanceOf(
      LimiteExcedidoError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 da Pixabay vira LimiteExcedidoError e bloqueia as próximas', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    await expect(buscar('Pizza', 'it')).rejects.toBeInstanceOf(
      LimiteExcedidoError,
    );
    await expect(buscar('Ramen', 'it')).rejects.toBeInstanceOf(
      LimiteExcedidoError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erro da Pixabay lança sem vazar a chave na mensagem', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const erro = await buscar('Pizza', 'it').catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe('Pixabay respondeu HTTP 500');
  });

  it('nome vazio não consulta a API', async () => {
    expect(await buscar('  ', 'it')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
