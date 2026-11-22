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
const MARCADOR = '__e2e_ocr__';
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';

describe('OCR do menu (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let prisma: { menu: { deleteMany: (a: object) => Promise<unknown> } };
  // OCR falso: o Tesseract real é lento e baixa idiomas pela rede
  const ocrFalso = { reconhecer: vi.fn() };

  const criarMenu = async () =>
    (await request(app.getHttpServer()).post('/menus').send({ restaurante: MARCADOR })).body
      .id as string;

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-ocr-'));
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
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('roda o OCR e grava o texto no menu (200)', async () => {
    ocrFalso.reconhecer.mockResolvedValueOnce('Pizza Margherita 30,00');
    const id = await criarMenu();
    await request(app.getHttpServer()).post(`/menus/${id}/foto`).attach('foto', PNG, 'c.png');

    const res = await request(app.getHttpServer()).post(`/menus/${id}/ocr`).expect(200);
    expect(res.body.textoOcr).toBe('Pizza Margherita 30,00');
    expect(res.body.status).toBe('RECEBIDO');
    expect(ocrFalso.reconhecer).toHaveBeenCalledWith(expect.any(Buffer)); // recebeu os bytes da foto
  });

  it('menu sem foto responde 409', async () => {
    const id = await criarMenu();
    await request(app.getHttpServer()).post(`/menus/${id}/ocr`).expect(409);
  });

  it('menu inexistente responde 404', () =>
    request(app.getHttpServer()).post(`/menus/${UUID_INEXISTENTE}/ocr`).expect(404));

  it('falha no OCR responde 500 e marca o menu como ERRO', async () => {
    ocrFalso.reconhecer.mockRejectedValueOnce(new Error('falhou'));
    const id = await criarMenu();
    await request(app.getHttpServer()).post(`/menus/${id}/foto`).attach('foto', PNG, 'c.png');

    await request(app.getHttpServer()).post(`/menus/${id}/ocr`).expect(500);
    const menu = await request(app.getHttpServer()).get(`/menus/${id}`);
    expect(menu.body.status).toBe('ERRO');
  });
});
