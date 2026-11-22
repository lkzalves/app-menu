import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';

// PNG 1x1 válido: é o "download" falso da Pixabay
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const MARCADOR = '__e2e_img__';
const IDIOMA = '__e2e_im__'; // máx. 10 caracteres (limite do DTO); os pratos de teste levam este idioma
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';
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

  beforeAll(async () => {
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

    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(200);

    // O menu volta com a foto do prato, sem expor a chave do storage nem a URL de origem
    const [imagem] = res.body.itens[0].dish.imagens;
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

  it('é idempotente e usa uma busca só para dois itens do mesmo prato', async () => {
    const { menuId, dishIds } = await criarMenu('Lasagna');
    // Segundo item apontando para o mesmo prato
    await prisma.menuItem.create({ data: { menuId, ordem: 1, nomeOriginal: 'Lasagna', dishId: dishIds[0] } });
    pixabayFalsa.buscar.mockResolvedValue(achada());
    fetchMock.mockImplementation(async () => respostaImagem());

    await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(200);
    await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(200);

    expect(pixabayFalsa.buscar).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.dishImage.count({ where: { dishId: dishIds[0] } })).toBe(1);
  });

  it('prato que nenhuma fonte achou fica sem foto', async () => {
    const { menuId } = await criarMenu('Prato Raro');
    pixabayFalsa.buscar.mockResolvedValue(null);

    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(200);

    expect(res.body.itens[0].dish.imagens).toEqual([]);
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

    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(200);

    expect(res.body.itens[0].dish.imagens).toEqual([]);
    expect(existsSync(join(pasta, 'pratos', dishIds[0]))).toBe(false);
  });

  it('429 da fonte propaga, mantém o que já foi gravado e a nova chamada continua de onde parou', async () => {
    const { menuId } = await criarMenu('Pizza', 'Risotto');
    pixabayFalsa.buscar
      .mockResolvedValueOnce(achada())
      .mockRejectedValueOnce(new HttpException('limite', 429));
    fetchMock.mockImplementation(async () => respostaImagem());

    await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(429);
    expect(pixabayFalsa.buscar).toHaveBeenCalledTimes(2);

    pixabayFalsa.buscar.mockResolvedValue(achada());
    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(200);

    // Pizza já tinha foto: só o Risotto foi buscado na segunda vez
    expect(pixabayFalsa.buscar).toHaveBeenCalledTimes(3);
    expect(pixabayFalsa.buscar).toHaveBeenLastCalledWith('Risotto', IDIOMA);
    expect(res.body.itens.map((i: { dish: { imagens: unknown[] } }) => i.dish.imagens.length)).toEqual([1, 1]);
  });

  it('404 para menu inexistente e 400 para id que não é UUID', async () => {
    await request(app.getHttpServer()).post(`/menus/${UUID_INEXISTENTE}/imagens`).expect(404);
    await request(app.getHttpServer()).post('/menus/abc/imagens').expect(400);
  });

  it('GET /imagens/:id: 404 se não existe ou está inativa, 400 se não é UUID', async () => {
    const { menuId, dishIds } = await criarMenu('Gnocchi');
    pixabayFalsa.buscar.mockResolvedValue(achada());
    fetchMock.mockImplementation(async () => respostaImagem());
    await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(200);
    const imagem = await prisma.dishImage.findFirstOrThrow({ where: { dishId: dishIds[0] } });

    await request(app.getHttpServer()).get(`/imagens/${imagem.id}`).expect(200);
    await prisma.dishImage.update({ where: { id: imagem.id }, data: { ativa: false } });
    await request(app.getHttpServer()).get(`/imagens/${imagem.id}`).expect(404);

    await request(app.getHttpServer()).get(`/imagens/${UUID_INEXISTENTE}`).expect(404);
    await request(app.getHttpServer()).get('/imagens/abc').expect(400);
  });
});
