import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  aguardarFila,
  limparFilas,
  prefixoUnico,
} from './helpers/aguardar-fila.js';

// PNG 1x1 válido (o OCR é falso, só precisa de uma imagem aceita no upload)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const MARCADOR = '__e2e_pratos__';
// Idioma dos menus de teste (máx. 10 caracteres, limite do DTO). Os pratos criados no catálogo levam
// este idioma e são apagados no fim. O nome do teste sem idioma usa "und" e é apagado pelo nome.
const IDIOMA = '__e2e_pr__';
const NOME_SEM_IDIOMA = 'PRATO SEM IDIOMA E2E';
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';
const FILAS = ['ocr', 'imagens', 'descricoes'];
const regiao = (x = 10) => ({ x, y: 20, largura: 100, altura: 30 });
const grupo = (x = 10) => ({ prato: regiao(x) });

describe('Marcar pratos (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  // OCR falso: o Tesseract real é lento e baixa idiomas pela rede
  const ocrFalso = { reconhecer: vi.fn(), reconhecerRegioes: vi.fn() };
  // O OCR agora dispara a busca de foto e descrição sozinho: sem fontes falsas iria para a rede
  const pixabayFalsa = { buscar: vi.fn() };
  const wikipediaFalsa = { buscar: vi.fn() };

  // Marca os pratos (202), espera o worker terminar tudo e devolve o menu como o app o veria
  const marcar = async (id: string, regioes: ReturnType<typeof regiao>[]) => {
    const res = await request(app.getHttpServer())
      .post(`/menus/${id}/pratos`)
      .send({ grupos: regioes.map((r) => ({ prato: r })) })
      .expect(202);
    expect(res.body).toEqual({ itens: regioes.length });
    await aguardarFila(app, FILAS);
    const menu = await request(app.getHttpServer())
      .get(`/menus/${id}`)
      .expect(200);
    return menu.body;
  };

  const criarMenu = async (comFoto = true, idioma: string | null = IDIOMA) => {
    const { body } = await request(app.getHttpServer())
      .post('/menus')
      .send({ restaurante: MARCADOR, ...(idioma && { idioma }) });
    if (comFoto) {
      await request(app.getHttpServer())
        .post(`/menus/${body.id}/foto`)
        .attach('foto', PNG, 'c.png');
    }
    return body.id as string;
  };

  beforeAll(async () => {
    // Prefixo próprio: os e2e rodam em paralelo e cada app de teste tem workers
    process.env.REDIS_PREFIX = prefixoUnico('bull-e2e-pr');
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-pratos-'));
    process.env.STORAGE_ROOT = pasta;

    const { AppModule } = await import('./../src/app.module.js');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const { OcrProvider } = await import('./../src/ocr/ocr.provider.js');
    const { PixabayProvider } =
      await import('./../src/imagens/pixabay.provider.js');
    const { WikipediaProvider } =
      await import('./../src/descricoes/wikipedia.provider.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OcrProvider)
      .useValue(ocrFalso)
      .overrideProvider(PixabayProvider)
      .useValue(pixabayFalsa)
      .overrideProvider(WikipediaProvider)
      .useValue(wikipediaFalsa)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    ocrFalso.reconhecerRegioes.mockReset();
    pixabayFalsa.buscar.mockReset().mockResolvedValue([]); // a fonte devolve uma lista (vazia = nada achado)
    wikipediaFalsa.buscar.mockReset().mockResolvedValue(null);
  });

  afterAll(async () => {
    await limparFilas(app);
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    await prisma.dish.deleteMany({
      where: {
        nomes: {
          some: {
            OR: [
              { idioma: IDIOMA },
              { idioma: 'und', nomeNormalizado: 'prato sem idioma e2e' },
            ],
          },
        },
      },
    });
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('cria um item por recorte, limpa o nome, grava a região e deixa o menu CONCLUIDO', async () => {
    ocrFalso.reconhecerRegioes
      .mockResolvedValueOnce(['TAGLIERE MISTO R$46'])
      .mockResolvedValueOnce(['| GAMBERI R$48']);
    const id = await criarMenu();

    const menu = await marcar(id, [regiao(10), regiao(200)]);

    expect(menu.status).toBe('CONCLUIDO');
    expect(menu.itens).toHaveLength(2);
    expect(menu.itens[0]).toMatchObject({
      ordem: 0,
      status: 'PRONTO',
      nomeOriginal: 'TAGLIERE MISTO',
      regiaoX: 10,
      regiaoY: 20,
      regiaoLargura: 100,
      regiaoAltura: 30,
    });
    expect(menu.itens[1]).toMatchObject({
      ordem: 1,
      status: 'PRONTO',
      nomeOriginal: 'GAMBERI',
      regiaoX: 200,
    });
    // Um job por recorte: o OCR recebeu os bytes da foto e uma região de cada vez
    expect(ocrFalso.reconhecerRegioes).toHaveBeenNthCalledWith(
      1,
      expect.any(Buffer),
      [regiao(10)],
    );
    expect(ocrFalso.reconhecerRegioes).toHaveBeenNthCalledWith(
      2,
      expect.any(Buffer),
      [regiao(200)],
    );
  });

  it('responde 202 com itens PROCESSANDO e só vira PRONTO quando o worker lê o nome', async () => {
    let liberar!: (textos: string[]) => void;
    ocrFalso.reconhecerRegioes.mockReturnValueOnce(
      new Promise<string[]>((r) => (liberar = r)),
    );
    const id = await criarMenu();

    await request(app.getHttpServer())
      .post(`/menus/${id}/pratos`)
      .send({ grupos: [grupo()] })
      .expect(202);
    const durante = (
      await request(app.getHttpServer()).get(`/menus/${id}`).expect(200)
    ).body;
    expect(durante.status).toBe('PROCESSANDO');
    expect(durante.itens[0]).toMatchObject({
      status: 'PROCESSANDO',
      nomeOriginal: '',
      dishId: null,
    });

    liberar(['RAVIOLI R$30']);
    await aguardarFila(app, FILAS);
    const depois = (
      await request(app.getHttpServer()).get(`/menus/${id}`).expect(200)
    ).body;
    expect(depois.status).toBe('CONCLUIDO');
    expect(depois.itens[0]).toMatchObject({
      status: 'PRONTO',
      nomeOriginal: 'RAVIOLI',
    });
  });

  it('reenviar substitui os pratos, sem duplicar', async () => {
    ocrFalso.reconhecerRegioes
      .mockResolvedValueOnce(['PIZZA A'])
      .mockResolvedValueOnce(['PIZZA B']);
    const id = await criarMenu();
    await marcar(id, [regiao(1), regiao(2)]);

    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['PIZZA C']);
    const menu = await marcar(id, [regiao(3)]);

    expect(
      menu.itens.map((i: { nomeOriginal: string }) => i.nomeOriginal),
    ).toEqual(['PIZZA C']);
  });

  it('descarta recorte que não virou texto e mantém a ordem dos demais', async () => {
    ocrFalso.reconhecerRegioes
      .mockResolvedValueOnce(['LASANHA'])
      .mockResolvedValueOnce(['  |  '])
      .mockResolvedValueOnce(['RISOTO R$ 40']);
    const id = await criarMenu();

    const menu = await marcar(id, [regiao(1), regiao(2), regiao(3)]);

    expect(menu.status).toBe('CONCLUIDO'); // o descartado também conta como lido
    expect(menu.itens).toMatchObject([
      { ordem: 0, nomeOriginal: 'LASANHA', regiaoX: 1 },
      { ordem: 2, nomeOriginal: 'RISOTO', regiaoX: 3 },
    ]);
  });

  it('liga cada prato ao catálogo, com o idioma do menu, e já pede foto e descrição dele', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['IL TARTARE R$47']);
    const id = await criarMenu();

    const menu = await marcar(id, [regiao()]);

    const nome = await prisma.dishName.findFirstOrThrow({
      where: { dishId: menu.itens[0].dishId },
    });
    expect(nome).toMatchObject({
      idioma: IDIOMA,
      nome: 'IL TARTARE',
      nomeNormalizado: 'tartare',
    });
    // O worker de OCR enfileirou as duas buscas, que rodaram com o nome lido e o idioma do menu
    expect(pixabayFalsa.buscar).toHaveBeenCalledWith('IL TARTARE', IDIOMA, { ignorar: new Set(), limite: 3 });
    expect(wikipediaFalsa.buscar).toHaveBeenCalledWith('IL TARTARE', IDIOMA);
  });

  it('o mesmo prato em dois menus compartilha o dishId, mesmo com erro de OCR', async () => {
    ocrFalso.reconhecerRegioes
      .mockResolvedValueOnce(['I GAMBERI R$48'])
      .mockResolvedValueOnce(['IGAMBERI']);
    const a = await criarMenu();
    const b = await criarMenu();

    const ma = await marcar(a, [regiao()]);
    const mb = await marcar(b, [regiao()]);

    expect(ma.itens[0].dishId).toBeTruthy();
    expect(mb.itens[0].dishId).toBe(ma.itens[0].dishId);
  });

  it('reenviar mantém o mesmo prato do catálogo', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValue(['PANNA COTTA']);
    const id = await criarMenu();
    const um = await marcar(id, [regiao()]);
    const dois = await marcar(id, [regiao()]);

    expect(dois.itens).toHaveLength(1);
    expect(dois.itens[0].dishId).toBe(um.itens[0].dishId);
  });

  it('menu sem idioma usa "und" no catálogo', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce([NOME_SEM_IDIOMA]);
    const id = await criarMenu(true, null);

    const menu = await marcar(id, [regiao()]);

    const nome = await prisma.dishName.findFirstOrThrow({
      where: { dishId: menu.itens[0].dishId },
    });
    expect(nome.idioma).toBe('und');
  });

  it('menu sem foto responde 409', async () => {
    const id = await criarMenu(false);
    await request(app.getHttpServer())
      .post(`/menus/${id}/pratos`)
      .send({ grupos: [grupo()] })
      .expect(409);
  });

  it('menu inexistente responde 404', () =>
    request(app.getHttpServer())
      .post(`/menus/${UUID_INEXISTENTE}/pratos`)
      .send({ grupos: [grupo()] })
      .expect(404));

  it.each([
    ['lista vazia', { grupos: [] }],
    ['sem o campo grupos', {}],
    ['formato antigo (regioes)', { regioes: [regiao()] }],
    ['grupo sem prato', { grupos: [{}] }],
    ['prato que não é objeto', { grupos: [{ prato: 'x' }] }],
    ['ingredientes que não é lista', { grupos: [{ ...grupo(), ingredientes: 'x' }] }],
    ['mais de 30 grupos', { grupos: Array.from({ length: 31 }, () => grupo()) }],
    ['largura zero', { grupos: [{ prato: { ...regiao(), largura: 0 } }] }],
    ['x negativo', { grupos: [{ prato: { ...regiao(), x: -1 } }] }],
    ['x decimal', { grupos: [{ prato: { ...regiao(), x: 1.5 } }] }],
    ['campo extra na região', { grupos: [{ prato: { ...regiao(), foo: 1 } }] }],
    ['campo extra no grupo', { grupos: [{ ...grupo(), foo: 1 }] }],
    [
      'mais de 5 regiões de ingredientes',
      { grupos: [{ ...grupo(), ingredientes: Array.from({ length: 6 }, () => regiao()) }] },
    ],
    ['ingrediente inválido', { grupos: [{ ...grupo(), ingredientes: [{ ...regiao(), altura: 0 }] }] }],
  ])('corpo inválido (%s) responde 400', async (_nome, corpo) => {
    const id = await criarMenu();
    await request(app.getHttpServer())
      .post(`/menus/${id}/pratos`)
      .send(corpo)
      .expect(400);
  });
});
