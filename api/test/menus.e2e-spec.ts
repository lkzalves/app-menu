import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// Roda no banco de desenvolvimento: tudo que o teste cria leva este marcador e é apagado no fim
const MARCADOR = '__e2e__';
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';

describe('Menus (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let menuId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } }); // itens saem por cascade
    await app.close();
  });

  describe('POST /menus', () => {
    it('cria o menu (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/menus')
        .send({ restaurante: MARCADOR, idioma: 'it' })
        .expect(201);
      expect(res.body).toMatchObject({ restaurante: MARCADOR, idioma: 'it', status: 'RECEBIDO' });
      menuId = res.body.id;
    });

    it('rejeita campo extra (400)', () =>
      request(app.getHttpServer()).post('/menus').send({ foo: 1 }).expect(400));

    it('rejeita idioma que não é texto (400)', () =>
      request(app.getHttpServer()).post('/menus').send({ idioma: 123 }).expect(400));
  });

  describe('GET /menus', () => {
    it('lista os menus (200)', async () => {
      const res = await request(app.getHttpServer()).get('/menus').expect(200);
      expect(res.body.some((m: { id: string }) => m.id === menuId)).toBe(true);
    });
  });

  describe('POST /menus/:id/itens', () => {
    const itens = (id: string) => `/menus/${id}/itens`;

    it('cria item com preço em vírgula e grava como 12.50 (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(itens(menuId))
        .send({ ordem: 2, nomeOriginal: 'Tiramisù', preco: 'R$ 12,50' })
        .expect(201);
      expect(res.body).toMatchObject({ menuId, ordem: 2, nomeOriginal: 'Tiramisù', preco: '12.5' });
    });

    it('cria item com preço numérico (201)', () =>
      request(app.getHttpServer())
        .post(itens(menuId))
        .send({ ordem: 1, nomeOriginal: 'Carbonara', preco: 14.9 })
        .expect(201));

    it('rejeita item sem nomeOriginal (400)', () =>
      request(app.getHttpServer()).post(itens(menuId)).send({ ordem: 3 }).expect(400));

    it('rejeita preço inválido (400)', () =>
      request(app.getHttpServer())
        .post(itens(menuId))
        .send({ ordem: 3, nomeOriginal: 'X', preco: 'abc' })
        .expect(400));

    it('rejeita preço negativo (400)', () =>
      request(app.getHttpServer())
        .post(itens(menuId))
        .send({ ordem: 3, nomeOriginal: 'X', preco: -5 })
        .expect(400));

    it('menu inexistente responde 404', () =>
      request(app.getHttpServer())
        .post(itens(UUID_INEXISTENTE))
        .send({ ordem: 1, nomeOriginal: 'X' })
        .expect(404));
  });

  describe('GET /menus/:id', () => {
    it('devolve o menu com os itens ordenados por ordem (200)', async () => {
      const res = await request(app.getHttpServer()).get(`/menus/${menuId}`).expect(200);
      expect(res.body.itens.map((i: { ordem: number }) => i.ordem)).toEqual([1, 2]);
    });

    it('UUID inexistente responde 404', () =>
      request(app.getHttpServer()).get(`/menus/${UUID_INEXISTENTE}`).expect(404));

    it('id que não é UUID responde 400', () =>
      request(app.getHttpServer()).get('/menus/abc').expect(400));
  });
});
