import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { LimiteExcedidoError } from '../src/fila/limite-excedido.error.js';
import { aguardarFila, limparFilas, prefixoUnico } from './helpers/aguardar-fila.js';

// PNG 1x1 válido (o OCR é falso, só precisa de uma imagem aceita no upload)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const MARCADOR = '__e2e_in__'; // restaurante dos menus deste arquivo
const IDIOMA = '__e2e_in__'; // máx. 10 caracteres (limite do DTO); pratos e ingredientes de teste levam este idioma
const FILAS = ['ocr', 'imagens', 'descricoes'];
const regiao = (x = 10, y = 20) => ({ x, y, largura: 100, altura: 30 });

const tomate = {
  nomePt: 'Tomate',
  texto: 'O tomate é o fruto do tomateiro.',
  url: 'https://pt.wikipedia.org/wiki/Tomate',
};
const manjericao = {
  nomePt: 'Manjericão',
  texto: 'O manjericão é uma erva aromática.',
  url: 'https://pt.wikipedia.org/wiki/Manjeric%C3%A3o',
};

describe('Ingredientes dos pratos (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  // Nada de rede e nada do Tesseract: OCR, Pixabay e Wikipedia falsos
  const ocrFalso = { reconhecer: vi.fn(), reconhecerRegioes: vi.fn() };
  const pixabayFalsa = { buscar: vi.fn() };
  const wikipediaFalsa = { buscar: vi.fn(), buscarVarios: vi.fn() };

  const criarMenu = async () => {
    const { body } = await request(app.getHttpServer()).post('/menus').send({ restaurante: MARCADOR, idioma: IDIOMA });
    await request(app.getHttpServer()).post(`/menus/${body.id}/foto`).attach('foto', PNG, 'c.png');
    return body.id as string;
  };

  // Marca os grupos (202), espera os workers terminarem tudo e devolve o menu como o app o veria
  const marcar = async (id: string, grupos: object[]) => {
    await request(app.getHttpServer()).post(`/menus/${id}/pratos`).send({ grupos }).expect(202);
    await aguardarFila(app, FILAS);
    return (await request(app.getHttpServer()).get(`/menus/${id}`).expect(200)).body;
  };

  const limparDados = async () => {
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } }); // leva itens e ingredientes dos itens junto
    await prisma.dish.deleteMany({ where: { nomes: { some: { idioma: IDIOMA } } } });
    await prisma.ingrediente.deleteMany({ where: { nomes: { some: { idioma: IDIOMA } } } });
  };

  beforeAll(async () => {
    // Prefixo próprio: os e2e rodam em paralelo e cada app de teste tem workers
    process.env.REDIS_PREFIX = prefixoUnico('bull-e2e-in');
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-ingredientes-'));
    process.env.STORAGE_ROOT = pasta;

    const { AppModule } = await import('./../src/app.module.js');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const { OcrProvider } = await import('./../src/ocr/ocr.provider.js');
    const { PixabayProvider } = await import('./../src/imagens/pixabay.provider.js');
    const { WikipediaProvider } = await import('./../src/descricoes/wikipedia.provider.js');
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
    await limparDados(); // sobra de uma execução que parou no meio
  });

  beforeEach(async () => {
    // A fila "descricoes" deixa passar 15 jobs por minuto (limite da Wikipedia); este arquivo roda mais
    // que isso, então zera o contador a cada teste
    await app.get<Queue>(getQueueToken('descricoes')).removeRateLimitKey();
    ocrFalso.reconhecerRegioes.mockReset();
    pixabayFalsa.buscar.mockReset().mockResolvedValue([]);
    wikipediaFalsa.buscar.mockReset().mockResolvedValue(null);
    wikipediaFalsa.buscarVarios.mockReset().mockResolvedValue(new Map());
  });

  afterAll(async () => {
    await limparFilas(app);
    await limparDados();
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('lê as linhas de ingredientes junto com o prato, separa e descreve cada um', async () => {
    ocrFalso.reconhecerRegioes
      .mockResolvedValueOnce(['MARGHERITA R$40', 'Pomodoro, mozzarella', 'e basilico (fresco)'])
      .mockResolvedValueOnce(['PIZZA BIANCA']);
    wikipediaFalsa.buscarVarios.mockResolvedValue(
      new Map([
        ['Pomodoro', tomate],
        ['basilico', manjericao],
      ]),
    );
    const id = await criarMenu();

    const menu = await marcar(id, [
      { prato: regiao(10, 20), ingredientes: [regiao(10, 60), regiao(10, 100)] },
      { prato: regiao(200, 20) }, // prato sem ingredientes
    ]);

    // Um job de OCR por prato: o prato e as duas linhas foram lidos numa chamada só
    expect(ocrFalso.reconhecerRegioes).toHaveBeenNthCalledWith(1, expect.any(Buffer), [
      regiao(10, 20),
      regiao(10, 60),
      regiao(10, 100),
    ]);
    expect(ocrFalso.reconhecerRegioes).toHaveBeenNthCalledWith(2, expect.any(Buffer), [regiao(200, 20)]);

    expect(menu.status).toBe('CONCLUIDO');
    expect(menu.itens[0].nomeOriginal).toBe('MARGHERITA');
    // Na ordem do cardápio; sem artigo na Wikipedia (mozzarella), só o nome
    expect(menu.itens[0].ingredientes).toMatchObject([
      { ordem: 0, nomeOriginal: 'Pomodoro', ingrediente: { nomePt: 'Tomate', descricao: tomate.texto, descricaoUrl: tomate.url } },
      { ordem: 1, nomeOriginal: 'mozzarella', ingrediente: { nomePt: null, descricao: null, descricaoUrl: null } },
      { ordem: 2, nomeOriginal: 'basilico', ingrediente: { nomePt: 'Manjericão', descricao: manjericao.texto } },
    ]);
    expect(menu.itens[1].nomeOriginal).toBe('PIZZA BIANCA');
    expect(menu.itens[1].ingredientes).toEqual([]);

    // Uma consulta em lote para o item inteiro, com o idioma do menu
    expect(wikipediaFalsa.buscarVarios).toHaveBeenCalledTimes(1);
    expect(wikipediaFalsa.buscarVarios).toHaveBeenCalledWith(['Pomodoro', 'mozzarella', 'basilico'], IDIOMA);
  });

  it('cache compartilhado: o mesmo ingrediente em outro menu reaproveita o do catálogo, sem nova consulta', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValue(['PIZZA', 'Cebola']);
    wikipediaFalsa.buscarVarios.mockResolvedValue(new Map([['Cebola', tomate]]));
    const a = await criarMenu();
    const b = await criarMenu();

    await marcar(a, [{ prato: regiao(), ingredientes: [regiao(10, 60)] }]);
    const menuB = await marcar(b, [{ prato: regiao(), ingredientes: [regiao(10, 60)] }]);

    const idDoIngrediente = (menuId: string) =>
      prisma.menuItemIngrediente
        .findFirstOrThrow({ where: { menuItem: { menuId } } })
        .then((l) => l.ingredienteId);
    expect(await idDoIngrediente(b)).toBe(await idDoIngrediente(a));
    expect(menuB.itens[0].ingredientes[0].ingrediente.descricao).toBe(tomate.texto);
    expect(wikipediaFalsa.buscarVarios).toHaveBeenCalledTimes(1); // o do menu B já nasceu descrito
  });

  it('ingrediente sem artigo: marca a tentativa e não insiste dentro de 30 dias', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValue(['PRATO RARO', 'ingrediente raríssimo']);
    const a = await criarMenu();
    const b = await criarMenu();

    const menu = await marcar(a, [{ prato: regiao(), ingredientes: [regiao(10, 60)] }]);
    await marcar(b, [{ prato: regiao(), ingredientes: [regiao(10, 60)] }]);

    expect(menu.itens[0].ingredientes[0]).toMatchObject({
      nomeOriginal: 'ingrediente raríssimo',
      ingrediente: { descricao: null },
    });
    const ing = await prisma.ingrediente.findFirstOrThrow({
      where: { nomes: { some: { idioma: IDIOMA, nomeNormalizado: 'ingrediente rarissimo' } } },
    });
    expect(ing.descricaoBuscadaEm).toBeInstanceOf(Date);
    expect(wikipediaFalsa.buscarVarios).toHaveBeenCalledTimes(1); // o menu B não consultou de novo
  });

  it('linhas que não viram ingrediente deixam o prato sem lista e sem job de descrição', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValue(['TIRAMISU', ' | ', 'R$ 12,50']);
    const id = await criarMenu();

    const menu = await marcar(id, [{ prato: regiao(), ingredientes: [regiao(10, 60), regiao(10, 100)] }]);

    expect(menu.itens[0]).toMatchObject({ nomeOriginal: 'TIRAMISU', ingredientes: [] });
    expect(wikipediaFalsa.buscarVarios).not.toHaveBeenCalled();
  });

  it('reenviar substitui os pratos e leva os ingredientes antigos junto', async () => {
    ocrFalso.reconhecerRegioes
      .mockResolvedValueOnce(['PIZZA A', 'Azeitona'])
      .mockResolvedValueOnce(['PIZZA B']);
    const id = await criarMenu();
    await marcar(id, [{ prato: regiao(), ingredientes: [regiao(10, 60)] }]);

    const menu = await marcar(id, [{ prato: regiao(5) }]);

    expect(menu.itens).toHaveLength(1);
    expect(menu.itens[0]).toMatchObject({ nomeOriginal: 'PIZZA B', ingredientes: [] });
    expect(await prisma.menuItemIngrediente.count({ where: { menuItem: { menuId: id } } })).toBe(0);
  });

  it('429 da Wikipedia pausa a fila e o lote é refeito sozinho', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValue(['PIZZA', 'Oregano']);
    wikipediaFalsa.buscarVarios
      .mockRejectedValueOnce(new LimiteExcedidoError('Wikipedia', 200)) // espera curta: o teste não espera o Retry-After real
      .mockResolvedValue(new Map([['Oregano', tomate]]));
    const id = await criarMenu();

    const menu = await marcar(id, [{ prato: regiao(), ingredientes: [regiao(10, 60)] }]);

    expect(wikipediaFalsa.buscarVarios).toHaveBeenCalledTimes(2);
    expect(menu.itens[0].ingredientes[0].ingrediente.descricao).toBe(tomate.texto);
  });
});
