import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { LimiteExcedidoError } from '../src/fila/limite-excedido.error.js';
import { aguardarFila, limparFilas, prefixoUnico } from './helpers/aguardar-fila.js';

// PNG 1x1 válido: é o "download" falso da Pixabay
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const MARCADOR = '__e2e_img__';
const IDIOMA = '__e2e_im__'; // máx. 10 caracteres (limite do DTO); os pratos de teste levam este idioma
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';
const FILAS = ['imagens'];
const URL_FOTO = 'https://cdn.pixabay.com/photo/x_640.jpg';

const achada = (urlDownload = URL_FOTO) => ({
  fonte: 'PIXABAY' as const,
  urlDownload,
  paginaOrigem: 'https://pixabay.com/photos/x-1/',
  credito: 'fotografo',
  licenca: 'Pixabay Content License',
});

const respostaImagem = (tipo = 'image/png') =>
  new Response(PNG, { status: 200, headers: { 'content-type': tipo } });

describe('Imagens dos pratos (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  // Fonte falsa no lugar da Pixabay: nada de rede nem de chave neste teste
  const pixabayFalsa = { buscar: vi.fn() };
  const fetchMock = vi.fn(); // só o download passa por fetch (o supertest usa http)

  // Menu com um item por nome, cada um ligado a um prato novo do catálogo
  const criarMenu = async (...nomes: string[]) => {
    const menu = await prisma.menu.create({ data: { restaurante: MARCADOR, idioma: IDIOMA } });
    const dishIds: string[] = [];
    for (const [ordem, nome] of nomes.entries()) {
      const dish = await prisma.dish.create({
        data: { nomes: { create: { nome, nomeNormalizado: `${nome.toLowerCase()} e2e img`, idioma: IDIOMA } } },
      });
      await prisma.menuItem.create({ data: { menuId: menu.id, ordem, nomeOriginal: nome, dishId: dish.id } });
      dishIds.push(dish.id);
    }
    return { menuId: menu.id, dishIds };
  };

  // Enfileira, espera o worker terminar e devolve o menu como o app o veria
  const pedirImagens = async (menuId: string) => {
    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(202);
    await aguardarFila(app, FILAS);
    const menu = await request(app.getHttpServer()).get(`/menus/${menuId}`).expect(200);
    return { enfileirado: res.body, menu: menu.body };
  };

  beforeAll(async () => {
    // Prefixo próprio: os e2e rodam em paralelo e cada app de teste tem workers; sem isso o worker
    // de um arquivo consumiria jobs de outro, com os providers falsos errados
    process.env.REDIS_PREFIX = prefixoUnico('bull-e2e-img');
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-imagens-'));
    process.env.STORAGE_ROOT = pasta;

    const { AppModule } = await import('./../src/app.module.js');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const { PixabayProvider } = await import('./../src/imagens/pixabay.provider.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PixabayProvider)
      .useValue(pixabayFalsa)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    pixabayFalsa.buscar.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await limparFilas(app);
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    // DishImage some junto (onDelete: Cascade)
    await prisma.dish.deleteMany({ where: { nomes: { some: { idioma: IDIOMA } } } });
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('baixa a foto, grava o DishImage e serve o arquivo em GET /imagens/:id (200)', async () => {
    const { menuId, dishIds } = await criarMenu('Tiramisu');
    pixabayFalsa.buscar.mockResolvedValue(achada());
    fetchMock.mockImplementation(async () => respostaImagem());

    const { enfileirado, menu } = await pedirImagens(menuId);
    expect(enfileirado).toEqual({ pratos: 1 });

    // O menu volta com a foto do prato, sem expor a chave do storage nem a URL de origem
    const [imagem] = menu.itens[0].dish.imagens;
    expect(imagem).toEqual({
      id: expect.any(String),
      fonte: 'PIXABAY',
      paginaOrigem: 'https://pixabay.com/photos/x-1/',
      credito: 'fotografo',
      licenca: 'Pixabay Content License',
    });
    expect(pixabayFalsa.buscar).toHaveBeenCalledWith('Tiramisu', IDIOMA);
    expect(fetchMock).toHaveBeenCalledWith(URL_FOTO);

    // Arquivo gravado no storage e servido com os mesmos bytes
    expect(readdirSync(join(pasta, 'pratos', dishIds[0]))).toHaveLength(1);
    const foto = await request(app.getHttpServer()).get(`/imagens/${imagem.id}`).expect(200);
    expect(foto.headers['content-type']).toBe('image/png');
    expect(foto.headers['cache-control']).toContain('immutable');
    expect(foto.body).toEqual(PNG);
  });

  it('é idempotente: dois itens do mesmo prato viram um job e pedir de novo não busca outra vez', async () => {
    const { menuId, dishIds } = await criarMenu('Lasagna');
    // Segundo item apontando para o mesmo prato
    await prisma.menuItem.create({ data: { menuId, ordem: 1, nomeOriginal: 'Lasagna', dishId: dishIds[0] } });
    pixabayFalsa.buscar.mockResolvedValue(achada());
    fetchMock.mockImplementation(async () => respostaImagem());

    // Dois itens, um prato: um job só
    const primeira = await pedirImagens(menuId);
    expect(primeira.enfileirado).toEqual({ pratos: 1 });
    await pedirImagens(menuId);

    expect(pixabayFalsa.buscar).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.dishImage.count({ where: { dishId: dishIds[0] } })).toBe(1);
  });

  it('prato que nenhuma fonte achou fica sem foto', async () => {
    const { menuId } = await criarMenu('Prato Raro');
    pixabayFalsa.buscar.mockResolvedValue(null);

    const { menu } = await pedirImagens(menuId);

    expect(menu.itens[0].dish.imagens).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['o arquivo não é imagem', URL_FOTO, () => respostaImagem('text/html')],
    ['a URL não é https', 'http://cdn.pixabay.com/photo/x_640.jpg', () => respostaImagem()],
    ['o download responde erro', URL_FOTO, () => new Response('', { status: 404 })],
  ])('ignora a foto quando %s', async (_caso, url, resposta) => {
    // Nome único por caso: DishName tem @@unique([idioma, nomeNormalizado])
    const { menuId, dishIds } = await criarMenu(`Prato Ruim ${_caso}`);
    pixabayFalsa.buscar.mockResolvedValue(achada(url));
    fetchMock.mockImplementation(async () => resposta());

    const { menu } = await pedirImagens(menuId);

    expect(menu.itens[0].dish.imagens).toEqual([]);
    expect(existsSync(join(pasta, 'pratos', dishIds[0]))).toBe(false);
  });

  it('429 da fonte pausa a fila, mantém o que já foi gravado e o job é refeito sozinho', async () => {
    const { menuId } = await criarMenu('Pizza', 'Risotto');
    pixabayFalsa.buscar
      .mockResolvedValueOnce(achada())
      .mockRejectedValueOnce(new LimiteExcedidoError('Pixabay', 200)) // espera curta: o teste não espera 60 s
      .mockResolvedValue(achada());
    fetchMock.mockImplementation(async () => respostaImagem());

    const { menu } = await pedirImagens(menuId);

    // Pizza gravada; Risotto tomou 429, esperou e foi refeito
    expect(pixabayFalsa.buscar).toHaveBeenCalledTimes(3);
    expect(pixabayFalsa.buscar).toHaveBeenLastCalledWith('Risotto', IDIOMA);
    expect(menu.itens.map((i: { dish: { imagens: unknown[] } }) => i.dish.imagens.length)).toEqual([1, 1]);
  });

  it('erro de rede na fonte é tentado de novo (backoff) e acaba funcionando', async () => {
    const { menuId } = await criarMenu('Prato Instavel');
    pixabayFalsa.buscar.mockRejectedValueOnce(new Error('rede caiu')).mockResolvedValue(achada());
    fetchMock.mockImplementation(async () => respostaImagem());

    const { menu } = await pedirImagens(menuId);

    expect(pixabayFalsa.buscar).toHaveBeenCalledTimes(2);
    expect(menu.itens[0].dish.imagens).toHaveLength(1);
  }, 20_000); // o backoff da 1ª tentativa é de 5 s

  it('404 para menu inexistente e 400 para id que não é UUID', async () => {
    await request(app.getHttpServer()).post(`/menus/${UUID_INEXISTENTE}/imagens`).expect(404);
    await request(app.getHttpServer()).post('/menus/abc/imagens').expect(400);
  });

  it('GET /imagens/:id: 404 se não existe ou está inativa, 400 se não é UUID', async () => {
    const { menuId, dishIds } = await criarMenu('Gnocchi');
    pixabayFalsa.buscar.mockResolvedValue(achada());
    fetchMock.mockImplementation(async () => respostaImagem());
    await pedirImagens(menuId);
    const imagem = await prisma.dishImage.findFirstOrThrow({ where: { dishId: dishIds[0] } });

    await request(app.getHttpServer()).get(`/imagens/${imagem.id}`).expect(200);
    await prisma.dishImage.update({ where: { id: imagem.id }, data: { ativa: false } });
    await request(app.getHttpServer()).get(`/imagens/${imagem.id}`).expect(404);

    await request(app.getHttpServer()).get(`/imagens/${UUID_INEXISTENTE}`).expect(404);
    await request(app.getHttpServer()).get('/imagens/abc').expect(400);
  });
});
