import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { aguardarFila, limparFilas, prefixoUnico } from './helpers/aguardar-fila.js';

// PNG 1x1 válido: é o "download" falso da Pixabay
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const MARCADOR = '__e2e_nee__';
const IDIOMA = '__e2e_ne__'; // máx. 10 caracteres (limite do DTO)
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';
const FILAS = ['imagens'];
const URL_A = 'https://cdn.pixabay.com/photo/a_640.jpg';
const URL_B = 'https://cdn.pixabay.com/photo/b_640.jpg';

const achada = (urlDownload: string) => ({
  fonte: 'PIXABAY' as const,
  urlDownload,
  paginaOrigem: 'https://pixabay.com/photos/x-1/',
  credito: 'fotografo',
  licenca: 'Pixabay Content License',
});

describe('Não é esse prato (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  const pixabayFalsa = { buscar: vi.fn() };
  const fetchMock = vi.fn(); // só o download passa por fetch (o supertest usa http)

  // Fonte falsa que respeita `ignorar`, como a Pixabay de verdade: devolve a primeira foto não rejeitada
  const fonteCom = (...urls: string[]) =>
    pixabayFalsa.buscar.mockImplementation(
      async (_nome: string, _idioma: string, ignorar?: ReadonlySet<string>) => {
        const url = urls.find((u) => !ignorar?.has(u));
        return url ? achada(url) : null;
      },
    );

  const criarMenu = async (nome: string, comPrato = true) => {
    const menu = await prisma.menu.create({ data: { restaurante: MARCADOR, idioma: IDIOMA } });
    const dish = comPrato
      ? await prisma.dish.create({
          data: { nomes: { create: { nome, nomeNormalizado: `${nome.toLowerCase()} e2e nee`, idioma: IDIOMA } } },
        })
      : null;
    const item = await prisma.menuItem.create({
      data: { menuId: menu.id, ordem: 0, nomeOriginal: nome, dishId: dish?.id },
    });
    return { menuId: menu.id, itemId: item.id, dishId: dish?.id };
  };

  const buscarFotos = async (menuId: string) => {
    await request(app.getHttpServer()).post(`/menus/${menuId}/imagens`).expect(202);
    await aguardarFila(app, FILAS);
  };

  const fotosDoMenu = async (menuId: string) => {
    const res = await request(app.getHttpServer()).get(`/menus/${menuId}`).expect(200);
    return res.body.itens[0].dish.imagens as { id: string }[];
  };

  const rejeitar = (menuId: string, itemId: string, imagemId: string) =>
    request(app.getHttpServer()).post(`/menus/${menuId}/itens/${itemId}/nao-e-esse`).send({ imagemId });

  beforeAll(async () => {
    // Prefixo próprio: os e2e rodam em paralelo e cada app de teste tem workers
    process.env.REDIS_PREFIX = prefixoUnico('bull-e2e-nee');
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-nee-'));
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
    fetchMock.mockImplementation(
      async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await limparFilas(app);
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    await prisma.dish.deleteMany({ where: { nomes: { some: { idioma: IDIOMA } } } });
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('rejeita a foto: ela sai do ar e entra outra, nunca a mesma URL', async () => {
    const { menuId, itemId, dishId } = await criarMenu('Tiramisu');
    fonteCom(URL_A, URL_B);
    await buscarFotos(menuId);
    const [antiga] = await fotosDoMenu(menuId);

    const res = await rejeitar(menuId, itemId, antiga.id).expect(202);
    expect(res.body).toEqual({ trocada: true });
    await aguardarFila(app, FILAS);

    const fotos = await fotosDoMenu(menuId);
    expect(fotos).toHaveLength(1);
    expect(fotos[0].id).not.toBe(antiga.id);

    // A rejeitada fica inativa com o voto registrado, e deixa de ser servida
    const rejeitada = await prisma.dishImage.findUniqueOrThrow({ where: { id: antiga.id } });
    expect(rejeitada).toMatchObject({ ativa: false, votosNegativos: 1 });
    await request(app.getHttpServer()).get(`/imagens/${antiga.id}`).expect(404);

    // A nova veio de B: a busca recebeu A como "ignorar"
    const nova = await prisma.dishImage.findUniqueOrThrow({ where: { id: fotos[0].id } });
    expect(nova.urlOrigem).toBe(URL_B);
    const ultima = pixabayFalsa.buscar.mock.calls.at(-1)!;
    expect(ultima[2]).toEqual(new Set([URL_A]));
    expect(await prisma.dishImage.count({ where: { dishId, ativa: true } })).toBe(1);
  });

  it('é idempotente: repetir o voto na foto já rejeitada não rejeita a nova nem busca de novo', async () => {
    const { menuId, itemId } = await criarMenu('Lasagna');
    fonteCom(URL_A, URL_B);
    await buscarFotos(menuId);
    const [antiga] = await fotosDoMenu(menuId);

    await rejeitar(menuId, itemId, antiga.id).expect(202);
    await aguardarFila(app, FILAS);
    const [nova] = await fotosDoMenu(menuId);
    const chamadas = pixabayFalsa.buscar.mock.calls.length;

    const repetido = await rejeitar(menuId, itemId, antiga.id).expect(202);
    expect(repetido.body).toEqual({ trocada: false });
    await aguardarFila(app, FILAS);

    expect(pixabayFalsa.buscar.mock.calls.length).toBe(chamadas);
    expect((await fotosDoMenu(menuId)).map((f) => f.id)).toEqual([nova.id]);
    expect((await prisma.dishImage.findUniqueOrThrow({ where: { id: antiga.id } })).votosNegativos).toBe(1);
  });

  it('sem outra foto aceitável, o prato fica sem foto', async () => {
    const { menuId, itemId } = await criarMenu('Feijoada');
    fonteCom(URL_A);
    await buscarFotos(menuId);
    const [unica] = await fotosDoMenu(menuId);

    await rejeitar(menuId, itemId, unica.id).expect(202);
    await aguardarFila(app, FILAS);

    expect(await fotosDoMenu(menuId)).toEqual([]);
  });

  it('imagem de outro prato (404), item inexistente (404) e item sem prato (409)', async () => {
    const a = await criarMenu('Risotto');
    const b = await criarMenu('Gnocchi');
    fonteCom(URL_A, URL_B);
    await buscarFotos(b.menuId);
    const [fotoDeB] = await fotosDoMenu(b.menuId);

    await rejeitar(a.menuId, a.itemId, fotoDeB.id).expect(404);
    await rejeitar(a.menuId, UUID_INEXISTENTE, fotoDeB.id).expect(404);
    // O item existe, mas é de outro menu
    await rejeitar(a.menuId, b.itemId, fotoDeB.id).expect(404);

    const semPrato = await criarMenu('Sem prato', false);
    await rejeitar(semPrato.menuId, semPrato.itemId, fotoDeB.id).expect(409);

    // A foto de B continua intacta
    expect((await prisma.dishImage.findUniqueOrThrow({ where: { id: fotoDeB.id } })).ativa).toBe(true);
  });

  it('valida os ids: corpo sem uuid (400) e itemId inválido (400)', async () => {
    const { menuId, itemId } = await criarMenu('Paella');
    await rejeitar(menuId, itemId, 'nao-e-uuid').expect(400);
    await request(app.getHttpServer()).post(`/menus/${menuId}/itens/${itemId}/nao-e-esse`).send({}).expect(400);
    await request(app.getHttpServer())
      .post(`/menus/${menuId}/itens/xx/nao-e-esse`)
      .send({ imagemId: UUID_INEXISTENTE })
      .expect(400);
  });
});
