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
const MARCADOR = '__e2e_ev__';
const IDIOMA = '__e2e_ev__'; // máx. 10 caracteres (limite do DTO)
const UUID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';
const FILAS = ['ocr', 'imagens', 'descricoes'];
const regiao = { x: 10, y: 20, largura: 100, altura: 30 };

interface EventoSse {
  tipo: string;
  data: Record<string, string | undefined>;
}

// Cliente SSE mínimo com fetch (o supertest espera a resposta terminar, e o stream não termina)
function abrirStream(url: string) {
  const ctrl = new AbortController();
  const recebidos: EventoSse[] = [];
  const lendo = (async () => {
    const res = await fetch(url, { signal: ctrl.signal });
    const leitor = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      // Eventos são separados por linha em branco; cada um tem linhas "event:" e "data:"
      const blocos = buffer.split('\n\n');
      buffer = blocos.pop()!;
      for (const bloco of blocos) {
        const tipo = /^event: (.*)$/m.exec(bloco)?.[1] ?? 'message';
        const dados = /^data: (.*)$/m.exec(bloco)?.[1];
        recebidos.push({ tipo, data: dados ? JSON.parse(dados) : {} });
      }
    }
  })().catch(() => undefined); // abort() rejeita a leitura: esperado

  const tipos = () => recebidos.map((e) => e.tipo);
  return {
    recebidos,
    tipos,
    // Espera até todos os tipos pedidos terem chegado
    async aguardar(...esperados: string[]) {
      const fim = Date.now() + 10_000;
      while (Date.now() < fim) {
        if (esperados.every((t) => tipos().includes(t))) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(
        `Não chegou ${esperados.join(', ')}; chegou: ${tipos().join(', ')}`,
      );
    },
    fechar: () => ctrl.abort(),
    lendo,
  };
}

describe('Eventos SSE (e2e)', () => {
  let app: INestApplication<App>;
  let pasta: string;
  let url: string;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  const ocrFalso = { reconhecer: vi.fn(), reconhecerRegioes: vi.fn() };
  const pixabayFalsa = { buscar: vi.fn() };
  const wikipediaFalsa = { buscar: vi.fn() };
  const streams: ReturnType<typeof abrirStream>[] = [];

  const criarMenu = async () => {
    const { body } = await request(app.getHttpServer())
      .post('/menus')
      .send({ restaurante: MARCADOR, idioma: IDIOMA });
    await request(app.getHttpServer())
      .post(`/menus/${body.id}/foto`)
      .attach('foto', PNG, 'c.png');
    return body.id as string;
  };
  const abrir = async (menuId: string) => {
    const s = abrirStream(`${url}/menus/${menuId}/eventos`);
    streams.push(s);
    await s.aguardar('ready'); // só marca os pratos depois do stream aberto (é o contrato do app)
    return s;
  };
  const marcar = async (menuId: string) => {
    await request(app.getHttpServer())
      .post(`/menus/${menuId}/pratos`)
      .send({ regioes: [regiao] })
      .expect(202);
    await aguardarFila(app, FILAS);
  };

  beforeAll(async () => {
    process.env.REDIS_PREFIX = prefixoUnico('bull-e2e-ev');
    pasta = mkdtempSync(join(tmpdir(), 'app-menu-e2e-eventos-'));
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
    await app.listen(0); // o stream precisa de uma porta de verdade
    url = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    ocrFalso.reconhecerRegioes.mockReset();
    pixabayFalsa.buscar.mockReset().mockResolvedValue([]); // a fonte devolve uma lista (vazia = nada achado)
    wikipediaFalsa.buscar
      .mockReset()
      .mockResolvedValue({
        texto: 'Descrição.',
        url: 'https://pt.wikipedia.org/wiki/X',
      });
  });

  afterAll(async () => {
    await limparFilas(app);
    await prisma.menu.deleteMany({ where: { restaurante: MARCADOR } });
    await prisma.dish.deleteMany({
      where: { nomes: { some: { idioma: IDIOMA } } },
    });
    // Sem fechar os streams de propósito: app.close() tem que completá-los sozinho (senão trava aqui)
    await app.close();
    await Promise.all(streams.map((s) => s.lendo));
    rmSync(pasta, { recursive: true, force: true });
  });

  it('abre com "ready" e avisa item pronto, menu concluído e descrição do prato', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['EVENTO PIZZA R$30']);
    const id = await criarMenu();
    const stream = await abrir(id);

    await marcar(id);
    await stream.aguardar('item', 'menu', 'descricao');

    expect(stream.tipos()[0]).toBe('ready');
    expect(stream.recebidos.find((e) => e.tipo === 'item')?.data.menuId).toBe(
      id,
    );
    const dishId = (
      await prisma.menuItem.findFirstOrThrow({ where: { menuId: id } })
    ).dishId;
    expect(
      stream.recebidos.find((e) => e.tipo === 'descricao')?.data.dishId,
    ).toBe(dishId);
  });

  it('recorte sem texto avisa "removido"', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['  |  ']);
    const id = await criarMenu();
    const stream = await abrir(id);

    await marcar(id);
    await stream.aguardar('removido', 'menu');
  });

  it('não entrega eventos de outro menu', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValueOnce(['EVENTO LASANHA R$40']);
    const a = await criarMenu();
    const b = await criarMenu();
    const streamA = await abrir(a);
    const streamB = await abrir(b);

    await marcar(b);
    await streamB.aguardar('item', 'menu');
    await new Promise((r) => setTimeout(r, 300)); // tempo para um evento indevido chegar

    expect(streamA.tipos()).toEqual(['ready']);
  });

  it('evento de prato chega a todo menu que tem o prato, mesmo disparado por outro menu', async () => {
    ocrFalso.reconhecerRegioes.mockResolvedValue(['EVENTO RISOTTO R$50']);
    const a = await criarMenu();
    await marcar(a); // o prato já tem descrição: o menu B só vai "confirmar" o que existe
    const streamA = await abrir(a);

    const b = await criarMenu();
    await marcar(b);

    await streamA.aguardar('descricao');
    expect(streamA.tipos()).not.toContain('item'); // item é do menu B
  });

  it('404 para menu inexistente e 400 para id que não é UUID', async () => {
    await request(app.getHttpServer())
      .get(`/menus/${UUID_INEXISTENTE}/eventos`)
      .expect(404);
    await request(app.getHttpServer()).get('/menus/abc/eventos').expect(400);
  });
});
