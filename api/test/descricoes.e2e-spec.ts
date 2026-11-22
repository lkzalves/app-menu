import { HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';

const MARCADOR = '__e2e_desc__';
const IDIOMA = '__e2e_ds__'; // máx. 10 caracteres (limite do DTO); os pratos de teste levam este idioma
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';
const DIA_MS = 24 * 60 * 60 * 1000;

const achada = (texto = 'Uma sobremesa italiana.') => ({
  texto,
  url: 'https://pt.wikipedia.org/wiki/Tiramis%C3%B9',
});

describe('Descrições dos pratos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  // Wikipedia falsa: nada de rede neste teste
  const wikipediaFalsa = { buscar: vi.fn() };

  // Menu com um item por nome, cada um ligado a um prato novo do catálogo
  const criarMenu = async (...nomes: string[]) => {
    const menu = await prisma.menu.create({ data: { restaurante: MARCADOR, idioma: IDIOMA } });
    const dishIds: string[] = [];
    for (const [ordem, nome] of nomes.entries()) {
      const dish = await prisma.dish.create({
        // DishName tem @@unique([idioma, nomeNormalizado]): o sufixo evita colisão entre testes
        data: { nomes: { create: { nome, nomeNormalizado: `${nome.toLowerCase()} e2e desc`, idioma: IDIOMA } } },
      });
      await prisma.menuItem.create({ data: { menuId: menu.id, ordem, nomeOriginal: nome, dishId: dish.id } });
      dishIds.push(dish.id);
    }
    return { menuId: menu.id, dishIds };
  };

  beforeAll(async () => {
    const { AppModule } = await import('./../src/app.module.js');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const { WikipediaProvider } = await import('./../src/descricoes/wikipedia.provider.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WikipediaProvider)
      .useValue(wikipediaFalsa)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    wikipediaFalsa.buscar.mockReset();
  });

  afterAll(async () => {
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    await prisma.dish.deleteMany({ where: { nomes: { some: { idioma: IDIOMA } } } });
    await app.close();
  });

  it('grava descrição, link e data da tentativa, e o GET do menu devolve o texto e o link (200)', async () => {
    const { menuId, dishIds } = await criarMenu('Tiramisu');
    wikipediaFalsa.buscar.mockResolvedValue(achada());

    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);

    expect(wikipediaFalsa.buscar).toHaveBeenCalledWith('Tiramisu', IDIOMA);
    expect(res.body.itens[0].dish.descricao).toBe('Uma sobremesa italiana.');
    expect(res.body.itens[0].dish.descricaoUrl).toBe('https://pt.wikipedia.org/wiki/Tiramis%C3%B9');

    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishIds[0] } });
    expect(dish.descricaoBuscadaEm).toBeInstanceOf(Date);

    const get = await request(app.getHttpServer()).get(`/menus/${menuId}`).expect(200);
    expect(get.body.itens[0].dish.descricao).toBe('Uma sobremesa italiana.');
  });

  it('é idempotente e faz uma consulta só para dois itens do mesmo prato', async () => {
    const { menuId, dishIds } = await criarMenu('Lasagna');
    await prisma.menuItem.create({ data: { menuId, ordem: 1, nomeOriginal: 'Lasagna', dishId: dishIds[0] } });
    wikipediaFalsa.buscar.mockResolvedValue(achada());

    await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);
    await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);

    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(1);
  });

  it('prato sem artigo: marca a tentativa, não insiste por 30 dias e volta a tentar depois', async () => {
    const { menuId, dishIds } = await criarMenu('Prato Raro');
    wikipediaFalsa.buscar.mockResolvedValue(null);

    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);
    expect(res.body.itens[0].dish.descricao).toBeNull();
    expect(res.body.itens[0].dish.descricaoUrl).toBeNull();

    await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);
    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(1); // segunda chamada: dentro dos 30 dias

    // Tentativa de 31 dias atrás: consulta de novo, e agora existe artigo
    await prisma.dish.update({
      where: { id: dishIds[0] },
      data: { descricaoBuscadaEm: new Date(Date.now() - 31 * DIA_MS) },
    });
    wikipediaFalsa.buscar.mockResolvedValue(achada('Agora existe.'));
    const depois = await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);

    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(2);
    expect(depois.body.itens[0].dish.descricao).toBe('Agora existe.');
  });

  it('erro do provider devolve 500 e não marca a tentativa: a próxima chamada tenta de novo', async () => {
    const { menuId, dishIds } = await criarMenu('Prato Instavel');
    wikipediaFalsa.buscar.mockRejectedValueOnce(new Error('rede caiu'));

    await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(500);
    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishIds[0] } });
    expect(dish.descricaoBuscadaEm).toBeNull();

    wikipediaFalsa.buscar.mockResolvedValue(achada());
    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);
    expect(res.body.itens[0].dish.descricao).toBe('Uma sobremesa italiana.');
  });

  it('429 propaga, mantém o que já foi gravado e a nova chamada continua de onde parou', async () => {
    const { menuId } = await criarMenu('Pizza', 'Risotto');
    wikipediaFalsa.buscar
      .mockResolvedValueOnce(achada('Texto da pizza.'))
      .mockRejectedValueOnce(new HttpException('limite', 429));

    await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(429);
    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(2);

    wikipediaFalsa.buscar.mockResolvedValue(achada('Texto do risotto.'));
    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);

    // A pizza já tinha texto: só o risotto foi consultado na segunda vez
    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(3);
    expect(wikipediaFalsa.buscar).toHaveBeenLastCalledWith('Risotto', IDIOMA);
    expect(res.body.itens.map((i: { dish: { descricao: string } }) => i.dish.descricao)).toEqual([
      'Texto da pizza.',
      'Texto do risotto.',
    ]);
  });

  it('item sem prato no catálogo é ignorado', async () => {
    const { menuId } = await criarMenu();
    await prisma.menuItem.create({ data: { menuId, ordem: 0, nomeOriginal: 'Item solto' } }); // dishId nulo

    await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(200);

    expect(wikipediaFalsa.buscar).not.toHaveBeenCalled();
  });

  it('404 para menu inexistente e 400 para id que não é UUID', async () => {
    await request(app.getHttpServer()).post(`/menus/${UUID_INEXISTENTE}/descricoes`).expect(404);
    await request(app.getHttpServer()).post('/menus/abc/descricoes').expect(400);
  });
});
