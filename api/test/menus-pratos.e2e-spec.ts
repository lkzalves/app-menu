import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';

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
const regiao = (x = 10) => ({ x, y: 20, largura: 100, altura: 30 });

describe('Marcar pratos (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  // OCR falso: o Tesseract real é lento e baixa idiomas pela rede
  const ocrFalso = { reconhecer: vi.fn(), reconhecerRegioes: vi.fn() };

  const criarMenu = async (comFoto = true, idioma: string | null = IDIOMA) => {
    const { body } = await request(app.getHttpServer())
      .post('/menus')
      .send({ restaurante: MARCADOR, ...(idioma && { idioma }) });
    if (comFoto) {
      await request(app.getHttpServer()).post(`/menus/${body.id}/foto`).attach('foto', PNG, 'c.png');
    }
    return body.id as string;
  };

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-pratos-'));
    process.env.STORAGE_ROOT = pasta;

    const { AppModule } = await import('./../src/app.module.js');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const { OcrProvider } = await import('./../src/ocr/ocr.provider.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OcrProvider)
      .useValue(ocrFalso)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    await prisma.dish.deleteMany({
      where: {
        nomes: {
          some: { OR: [{ idioma: IDIOMA }, { idioma: 'und', nomeNormalizado: 'prato sem idioma e2e' }] },
        },
      },
    });
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('cria um prato por recorte, limpa o nome e grava a região (200)', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['TAGLIERE MISTO R$46', '| GAMBERI R$48']);
    const id = await criarMenu();

    const res = await request(app.getHttpServer())
      .post(`/menus/${id}/pratos`)
      .send({ regioes: [regiao(10), regiao(200)] })
      .expect(200);

    expect(res.body.itens).toHaveLength(2);
    expect(res.body.itens[0]).toMatchObject({
      ordem: 0,
      nomeOriginal: 'TAGLIERE MISTO',
      regiaoX: 10,
      regiaoY: 20,
      regiaoLargura: 100,
      regiaoAltura: 30,
    });
    expect(res.body.itens[1]).toMatchObject({ ordem: 1, nomeOriginal: 'GAMBERI', regiaoX: 200 });
    // O OCR recebeu os bytes da foto e as regiões como o app mandou
    expect(ocrFalso.reconhecerRegioes).toHaveBeenCalledWith(expect.any(Buffer), [regiao(10), regiao(200)]);
  });

  it('reenviar substitui os pratos, sem duplicar', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['PIZZA A', 'PIZZA B']);
    const id = await criarMenu();
    await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send({ regioes: [regiao(1), regiao(2)] });

    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['PIZZA C']);
    const res = await request(app.getHttpServer())
      .post(`/menus/${id}/pratos`)
      .send({ regioes: [regiao(3)] })
      .expect(200);

    expect(res.body.itens.map((i: { nomeOriginal: string }) => i.nomeOriginal)).toEqual(['PIZZA C']);
  });

  it('descarta recorte que não virou texto e mantém a ordem dos demais', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['LASANHA', '  |  ', 'RISOTO R$ 40']);
    const id = await criarMenu();

    const res = await request(app.getHttpServer())
      .post(`/menus/${id}/pratos`)
      .send({ regioes: [regiao(1), regiao(2), regiao(3)] })
      .expect(200);

    expect(res.body.itens).toMatchObject([
      { ordem: 0, nomeOriginal: 'LASANHA', regiaoX: 1 },
      { ordem: 1, nomeOriginal: 'RISOTO', regiaoX: 3 },
    ]);
  });

  it('liga cada prato ao catálogo, com o idioma do menu', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['IL TARTARE R$47']);
    const id = await criarMenu();

    const res = await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send({ regioes: [regiao()] }).expect(200);

    const nome = await prisma.dishName.findFirstOrThrow({ where: { dishId: res.body.itens[0].dishId } });
    expect(nome).toMatchObject({ idioma: IDIOMA, nome: 'IL TARTARE', nomeNormalizado: 'tartare' });
  });

  it('o mesmo prato em dois menus compartilha o dishId, mesmo com erro de OCR', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['I GAMBERI R$48']).mockResolvedValueOnce(['IGAMBERI']);
    const a = await criarMenu();
    const b = await criarMenu();

    const ra = await request(app.getHttpServer()).post(`/menus/${a}/pratos`).send({ regioes: [regiao()] });
    const rb = await request(app.getHttpServer()).post(`/menus/${b}/pratos`).send({ regioes: [regiao()] });

    expect(ra.body.itens[0].dishId).toBeTruthy();
    expect(rb.body.itens[0].dishId).toBe(ra.body.itens[0].dishId);
  });

  it('reenviar mantém o mesmo prato do catálogo', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValue(['PANNA COTTA']);
    const id = await criarMenu();
    const um = await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send({ regioes: [regiao()] });
    const dois = await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send({ regioes: [regiao()] });
    ocrFalso.reconhecerRegioes.mockReset();

    expect(dois.body.itens).toHaveLength(1);
    expect(dois.body.itens[0].dishId).toBe(um.body.itens[0].dishId);
  });

  it('menu sem idioma usa "und" no catálogo', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce([NOME_SEM_IDIOMA]);
    const id = await criarMenu(true, null);

    const res = await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send({ regioes: [regiao()] }).expect(200);

    const nome = await prisma.dishName.findFirstOrThrow({ where: { dishId: res.body.itens[0].dishId } });
    expect(nome.idioma).toBe('und');
  });

  it('menu sem foto responde 409', async () => {
    const id = await criarMenu(false);
    await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send({ regioes: [regiao()] }).expect(409);
  });

  it('menu inexistente responde 404', () =>
    request(app.getHttpServer())
      .post(`/menus/${UUID_INEXISTENTE}/pratos`)
      .send({ regioes: [regiao()] })
      .expect(404));

  it.each([
    ['lista vazia', { regioes: [] }],
    ['sem o campo regioes', {}],
    ['mais de 30 regiões', { regioes: Array.from({ length: 31 }, () => regiao()) }],
    ['largura zero', { regioes: [{ ...regiao(), largura: 0 }] }],
    ['x negativo', { regioes: [{ ...regiao(), x: -1 }] }],
    ['x decimal', { regioes: [{ ...regiao(), x: 1.5 }] }],
    ['campo extra na região', { regioes: [{ ...regiao(), foo: 1 }] }],
  ])('região inválida (%s) responde 400', async (_nome, corpo) => {
    const id = await criarMenu();
    await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send(corpo).expect(400);
  });
});
