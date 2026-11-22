import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { LimiteExcedidoError } from '../src/fila/limite-excedido.error.js';
import { aguardarFila, limparFilas, prefixoUnico } from './helpers/aguardar-fila.js';

const MARCADOR = '__e2e_desc__';
const IDIOMA = '__e2e_ds__'; // máx. 10 caracteres (limite do DTO); os pratos de teste levam este idioma
const FILAS = ['descricoes'];
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

  // Enfileira, espera o worker terminar e devolve o menu como o app o veria
  const pedirDescricoes = async (menuId: string) => {
    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(202);
    await aguardarFila(app, FILAS);
    const menu = await request(app.getHttpServer()).get(`/menus/${menuId}`).expect(200);
    return { enfileirado: res.body, menu: menu.body };
  };

  beforeAll(async () => {
    // Prefixo próprio: os e2e rodam em paralelo e cada app de teste tem workers
    process.env.REDIS_PREFIX = prefixoUnico('bull-e2e-desc');
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
    await limparFilas(app);
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    await prisma.dish.deleteMany({ where: { nomes: { some: { idioma: IDIOMA } } } });
    await app.close();
  });

  it('grava descrição, link e data da tentativa, e o GET do menu devolve o texto e o link (200)', async () => {
    const { menuId, dishIds } = await criarMenu('Tiramisu');
    wikipediaFalsa.buscar.mockResolvedValue(achada());

    const { enfileirado, menu } = await pedirDescricoes(menuId);

    expect(enfileirado).toEqual({ pratos: 1 });
    expect(wikipediaFalsa.buscar).toHaveBeenCalledWith('Tiramisu', IDIOMA);
    expect(menu.itens[0].dish.descricao).toBe('Uma sobremesa italiana.');
    expect(menu.itens[0].dish.descricaoUrl).toBe('https://pt.wikipedia.org/wiki/Tiramis%C3%B9');

    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishIds[0] } });
    expect(dish.descricaoBuscadaEm).toBeInstanceOf(Date);

    const get = await request(app.getHttpServer()).get(`/menus/${menuId}`).expect(200);
    expect(get.body.itens[0].dish.descricao).toBe('Uma sobremesa italiana.');
  });

  it('é idempotente: dois itens do mesmo prato viram um job e pedir de novo não consulta outra vez', async () => {
    const { menuId, dishIds } = await criarMenu('Lasagna');
    await prisma.menuItem.create({ data: { menuId, ordem: 1, nomeOriginal: 'Lasagna', dishId: dishIds[0] } });
    wikipediaFalsa.buscar.mockResolvedValue(achada());

    expect((await pedirDescricoes(menuId)).enfileirado).toEqual({ pratos: 1 }); // dois itens, um job
    await pedirDescricoes(menuId);

    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(1);
  });

  it('prato sem artigo: marca a tentativa, não insiste por 30 dias e volta a tentar depois', async () => {
    const { menuId, dishIds } = await criarMenu('Prato Raro');
    wikipediaFalsa.buscar.mockResolvedValue(null);

    const { menu } = await pedirDescricoes(menuId);
    expect(menu.itens[0].dish.descricao).toBeNull();
    expect(menu.itens[0].dish.descricaoUrl).toBeNull();

    await pedirDescricoes(menuId);
    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(1); // segunda chamada: dentro dos 30 dias

    // Tentativa de 31 dias atrás: consulta de novo, e agora existe artigo
    await prisma.dish.update({
      where: { id: dishIds[0] },
      data: { descricaoBuscadaEm: new Date(Date.now() - 31 * DIA_MS) },
    });
    wikipediaFalsa.buscar.mockResolvedValue(achada('Agora existe.'));
    const { menu: depois } = await pedirDescricoes(menuId);

    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(2);
    expect(depois.itens[0].dish.descricao).toBe('Agora existe.');
  });

  it('erro do provider é tentado de novo (backoff) sem marcar a tentativa de "sem artigo"', async () => {
    const { menuId } = await criarMenu('Prato Instavel');
    wikipediaFalsa.buscar.mockRejectedValueOnce(new Error('rede caiu')).mockResolvedValue(achada());

    const { menu } = await pedirDescricoes(menuId);

    // Falha não gravou nada: a 2ª tentativa (após o backoff de 5 s) é que preencheu
    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(2);
    expect(menu.itens[0].dish.descricao).toBe('Uma sobremesa italiana.');
  }, 20_000);

  it('429 pausa a fila, mantém o que já foi gravado e o job é refeito sozinho', async () => {
    const { menuId } = await criarMenu('Pizza', 'Risotto');
    wikipediaFalsa.buscar
      .mockResolvedValueOnce(achada('Texto da pizza.'))
      .mockRejectedValueOnce(new LimiteExcedidoError('Wikipedia', 200)) // espera curta: o teste não espera o Retry-After real
      .mockResolvedValue(achada('Texto do risotto.'));

    const { menu } = await pedirDescricoes(menuId);

    expect(wikipediaFalsa.buscar).toHaveBeenCalledTimes(3);
    expect(wikipediaFalsa.buscar).toHaveBeenLastCalledWith('Risotto', IDIOMA);
    expect(menu.itens.map((i: { dish: { descricao: string } }) => i.dish.descricao)).toEqual([
      'Texto da pizza.',
      'Texto do risotto.',
    ]);
  });

  it('item sem prato no catálogo é ignorado', async () => {
    const { menuId } = await criarMenu();
    await prisma.menuItem.create({ data: { menuId, ordem: 0, nomeOriginal: 'Item solto' } }); // dishId nulo

    const res = await request(app.getHttpServer()).post(`/menus/${menuId}/descricoes`).expect(202);
    await aguardarFila(app, FILAS);

    expect(res.body).toEqual({ pratos: 0 });
    expect(wikipediaFalsa.buscar).not.toHaveBeenCalled();
  });

  it('404 para menu inexistente e 400 para id que não é UUID', async () => {
    await request(app.getHttpServer()).post(`/menus/${UUID_INEXISTENTE}/descricoes`).expect(404);
    await request(app.getHttpServer()).post('/menus/abc/descricoes').expect(400);
  });
});
