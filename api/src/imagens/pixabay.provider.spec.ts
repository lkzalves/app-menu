import type { ConfigService } from '@nestjs/config';
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
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: PixabayProvider;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const config = { getOrThrow: () => 'chave-falsa' } as unknown as ConfigService;
    provider = new PixabayProvider(config);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('monta a consulta com idioma do cardápio, categoria food e nome sem artigo', async () => {
    fetchMock.mockResolvedValue(resposta([]));
    await provider.buscar('Il Tiramisù', 'it');

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
    await provider.buscar('Ramen', 'und');
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('lang')).toBe('en');
  });

  it('devolve o primeiro resultado cujas tags combinam, com fonte e crédito', async () => {
    fetchMock.mockResolvedValue(resposta([hit('sunset, beach'), hit('tiramisu, dessert')]));
    const r = await provider.buscar('Tiramisù', 'it');
    expect(r).toEqual({
      fonte: 'PIXABAY',
      urlDownload: 'https://pixabay.com/get/x_640.jpg',
      paginaOrigem: 'https://pixabay.com/photos/x-1/',
      credito: 'fotografo',
      licenca: 'Pixabay Content License',
    });
  });

  it('devolve null quando nenhuma tag combina', async () => {
    fetchMock.mockResolvedValue(resposta([hit('sunset, beach')]));
    expect(await provider.buscar('Tiramisù', 'it')).toBeNull();
  });

  it('cache: a mesma consulta não vai de novo à Pixabay, nem quando não achou nada', async () => {
    fetchMock.mockResolvedValue(resposta([]));
    await provider.buscar('Tiramisù', 'it');
    await provider.buscar('Il Tiramisù', 'it'); // mesma consulta depois de tirar o artigo
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cache separa por idioma', async () => {
    fetchMock.mockImplementation(async () => resposta([]));
    await provider.buscar('Tiramisù', 'it');
    await provider.buscar('Tiramisù', 'pt');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cache expira depois de 24 h', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => resposta([]));
    await provider.buscar('Tiramisù', 'it');
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1000);
    await provider.buscar('Tiramisù', 'it');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('limite esgotado: responde o que veio, mas a próxima consulta vira 429 sem chamar a API', async () => {
    fetchMock.mockResolvedValue(
      resposta([hit('tiramisu')], { headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '30' } }),
    );
    expect(await provider.buscar('Tiramisù', 'it')).not.toBeNull();

    await expect(provider.buscar('Pizza', 'it')).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 da Pixabay vira 429 nosso e bloqueia as próximas', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    await expect(provider.buscar('Pizza', 'it')).rejects.toMatchObject({ status: 429 });
    await expect(provider.buscar('Ramen', 'it')).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erro da Pixabay lança sem vazar a chave na mensagem', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const erro = await provider.buscar('Pizza', 'it').catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe('Pixabay respondeu HTTP 500');
  });

  it('nome vazio não consulta a API', async () => {
    expect(await provider.buscar('  ', 'it')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
