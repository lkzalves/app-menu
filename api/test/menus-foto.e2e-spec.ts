import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';

// PNG 1x1 válido: o tipo é detectado pelos bytes, não pelo nome do arquivo
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const MARCADOR = '__e2e_foto__'; // único por arquivo: os e2e rodam em paralelo no mesmo banco
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';

describe('Foto do menu (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let menuId: string;
  let prisma: { menu: { deleteMany: (a: object) => Promise<unknown> } };

  // Conta só as imagens: o LocalDisk guarda temporários e metadados em .nest-storage
  const arquivos = () =>
    readdirSync(pasta, { recursive: true, withFileTypes: true }).filter(
      (e) => e.isFile() && !e.parentPath.includes('.nest-storage'),
    ).length;

  beforeAll(async () => {
    // Pasta temporária: não suja ./storage. Precisa vir antes de criar o AppModule
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-'));
    process.env.STORAGE_ROOT = pasta;

    const { AppModule } = await import('./../src/app.module.js');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/menus')
      .send({ restaurante: MARCADOR });
    menuId = res.body.id;
  });

  afterAll(async () => {
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('grava a foto e registra fotoKey no menu (201)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/menus/${menuId}/foto`)
      .attach('foto', PNG, 'cardapio.png')
      .expect(201);
    expect(res.body.fotoKey).toEqual(expect.stringMatching(/\.png$/));
    expect(existsSync(join(pasta, res.body.fotoKey))).toBe(true);
  });

  it('segunda foto troca a primeira e apaga a antiga', async () => {
    const antes = (await request(app.getHttpServer()).get(`/menus/${menuId}`)).body.fotoKey;
    const res = await request(app.getHttpServer())
      .post(`/menus/${menuId}/foto`)
      .attach('foto', PNG, 'outra.png')
      .expect(201);
    expect(res.body.fotoKey).not.toBe(antes);
    expect(existsSync(join(pasta, antes))).toBe(false);
    expect(existsSync(join(pasta, res.body.fotoKey))).toBe(true);
    expect(arquivos()).toBe(1);
  });

  it('arquivo de texto com nome .png responde 415 e não grava nada', async () => {
    const antes = arquivos();
    await request(app.getHttpServer())
      .post(`/menus/${menuId}/foto`)
      .attach('foto', Buffer.from('isso não é uma imagem'), 'falso.png')
      .expect(415);
    expect(arquivos()).toBe(antes);
  });

  it('sem arquivo responde 400', () =>
    request(app.getHttpServer()).post(`/menus/${menuId}/foto`).expect(400));

  it('menu inexistente responde 404 e não deixa arquivo órfão', async () => {
    const antes = arquivos();
    await request(app.getHttpServer())
      .post(`/menus/${UUID_INEXISTENTE}/foto`)
      .attach('foto', PNG, 'cardapio.png')
      .expect(404);
    expect(arquivos()).toBe(antes);
  });

  describe('GET /menus/:id/foto', () => {
    it('devolve os mesmos bytes enviados, como imagem, com ETag (200)', async () => {
      const res = await request(app.getHttpServer()).get(`/menus/${menuId}/foto`).expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toMatch(/^inline/);
      expect(res.headers['etag']).toBeDefined();
      expect(res.headers['cache-control']).toContain('private');
      expect(res.body).toEqual(PNG);
    });

    it('revalida pelo ETag (304)', async () => {
      const primeira = await request(app.getHttpServer()).get(`/menus/${menuId}/foto`).expect(200);
      await request(app.getHttpServer())
        .get(`/menus/${menuId}/foto`)
        .set('If-None-Match', primeira.headers['etag'])
        .expect(304);
    });

    it('menu sem foto responde 404', async () => {
      const novo = await request(app.getHttpServer()).post('/menus').send({ restaurante: MARCADOR });
      await request(app.getHttpServer()).get(`/menus/${novo.body.id}/foto`).expect(404);
    });

    it('menu inexistente responde 404 e id inválido responde 400', async () => {
      await request(app.getHttpServer()).get(`/menus/${UUID_INEXISTENTE}/foto`).expect(404);
      await request(app.getHttpServer()).get('/menus/xx/foto').expect(400);
    });
  });
});
