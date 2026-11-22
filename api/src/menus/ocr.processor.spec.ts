import { Job } from 'bullmq';
import { OcrProcessor } from './ocr.processor.js';

const job = (itemId = 'i1', extra: Partial<Job> = {}) =>
  ({
    data: { itemId },
    attemptsMade: 1,
    opts: { attempts: 3 },
    ...extra,
  }) as Job<{ itemId: string }>;

const itemProcessando = {
  status: 'PROCESSANDO',
  regiaoX: 1,
  regiaoY: 2,
  regiaoLargura: 30,
  regiaoAltura: 40,
  menu: { id: 'm1', fotoKey: 'menus/m1.png', idioma: 'it' },
};

describe('OcrProcessor', () => {
  const prisma = {
    menuItem: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    menu: { updateMany: vi.fn() },
    menuItemIngrediente: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const fotos = { getBuffer: vi.fn() };
  const ocr = { reconhecerRegioes: vi.fn() };
  const catalogo = { obterOuCriar: vi.fn(), obterOuCriarIngrediente: vi.fn() };
  const filaImagens = { addBulk: vi.fn() };
  const filaDescricoes = { addBulk: vi.fn() };
  const eventos = { publicar: vi.fn() };
  let processor: OcrProcessor;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.menuItem.count.mockResolvedValue(0);
    prisma.menuItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.menu.updateMany.mockResolvedValue({ count: 1 });
    fotos.getBuffer.mockResolvedValue(Buffer.from('foto'));
    catalogo.obterOuCriar.mockResolvedValue('d1');
    catalogo.obterOuCriarIngrediente.mockImplementation(async (nome: string) => `ing-${nome}`);
    // Transação interativa: o "tx" é o próprio mock, então as chamadas dentro dela ficam visíveis
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    processor = new OcrProcessor(
      prisma as never,
      fotos as never,
      ocr as never,
      catalogo as never,
      filaImagens as never,
      filaDescricoes as never,
      eventos as never,
    );
  });

  it('lê o recorte, liga ao catálogo, marca PRONTO e enfileira foto e descrição do prato', async () => {
    prisma.menuItem.findUnique.mockResolvedValue(itemProcessando);
    ocr.reconhecerRegioes.mockResolvedValue(['TAGLIERE MISTO R$46']);

    await processor.process(job());

    expect(ocr.reconhecerRegioes).toHaveBeenCalledWith(expect.any(Buffer), [
      { x: 1, y: 2, largura: 30, altura: 40 },
    ]);
    expect(catalogo.obterOuCriar).toHaveBeenCalledWith('TAGLIERE MISTO', 'it');
    expect(prisma.menuItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', status: 'PROCESSANDO' },
      data: { nomeOriginal: 'TAGLIERE MISTO', dishId: 'd1', status: 'PRONTO' },
    });
    const prato = { dishId: 'd1', nome: 'TAGLIERE MISTO', idioma: 'it' };
    expect(filaImagens.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: prato,
        opts: expect.objectContaining({ jobId: 'imagem-d1' }),
      }),
    ]);
    expect(filaDescricoes.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: prato,
        opts: expect.objectContaining({ jobId: 'descricao-d1' }),
      }),
    ]);
    // Nenhum recorte sobrando: o menu fica CONCLUIDO
    expect(prisma.menu.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'PROCESSANDO' },
      data: { status: 'CONCLUIDO' },
    });
    // O app é avisado do item pronto e, em seguida, do menu concluído
    expect(eventos.publicar.mock.calls).toEqual([
      [{ tipo: 'item', menuId: 'm1' }],
      [{ tipo: 'menu', menuId: 'm1' }],
    ]);
  });

  describe('ingredientes', () => {
    const comIngredientes = {
      ...itemProcessando,
      regioesIngredientes: [
        { x: 5, y: 50, largura: 300, altura: 20 },
        { x: 5, y: 75, largura: 300, altura: 20 },
      ],
    };

    it('lê prato e linhas num só OCR, grava os ingredientes e enfileira a descrição deles', async () => {
      prisma.menuItem.findUnique.mockResolvedValue(comIngredientes);
      ocr.reconhecerRegioes.mockResolvedValue([
        'MARGHERITA R$40',
        'Pomodoro, mozzarella',
        'e basilico (fresco)',
      ]);

      await processor.process(job());

      expect(ocr.reconhecerRegioes).toHaveBeenCalledTimes(1);
      expect(ocr.reconhecerRegioes).toHaveBeenCalledWith(expect.any(Buffer), [
        { x: 1, y: 2, largura: 30, altura: 40 },
        { x: 5, y: 50, largura: 300, altura: 20 },
        { x: 5, y: 75, largura: 300, altura: 20 },
      ]);
      expect(catalogo.obterOuCriarIngrediente.mock.calls).toEqual([
        ['Pomodoro', 'it'],
        ['mozzarella', 'it'],
        ['basilico', 'it'],
      ]);
      expect(prisma.menuItemIngrediente.createMany).toHaveBeenCalledWith({
        data: [
          { ordem: 0, nomeOriginal: 'Pomodoro', ingredienteId: 'ing-Pomodoro', menuItemId: 'i1' },
          { ordem: 1, nomeOriginal: 'mozzarella', ingredienteId: 'ing-mozzarella', menuItemId: 'i1' },
          { ordem: 2, nomeOriginal: 'basilico', ingredienteId: 'ing-basilico', menuItemId: 'i1' },
        ],
      });
      expect(filaDescricoes.addBulk).toHaveBeenCalledTimes(2); // prato e ingredientes
      expect(filaDescricoes.addBulk).toHaveBeenLastCalledWith([
        expect.objectContaining({
          name: 'ingredientes',
          data: { itemId: 'i1' },
          opts: expect.objectContaining({ jobId: 'ingredientes-i1' }),
        }),
      ]);
    });

    it('linhas sem texto aproveitável: o prato fica, sem ingredientes e sem job de descrição', async () => {
      prisma.menuItem.findUnique.mockResolvedValue(comIngredientes);
      ocr.reconhecerRegioes.mockResolvedValue(['MARGHERITA', ' | ', '12,50']);

      await processor.process(job());

      expect(prisma.menuItem.updateMany).toHaveBeenCalled();
      expect(prisma.menuItemIngrediente.createMany).not.toHaveBeenCalled();
      expect(filaDescricoes.addBulk).toHaveBeenCalledTimes(1); // só a do prato
    });

    it('prato sem texto: some da lista junto com as linhas de ingredientes', async () => {
      prisma.menuItem.findUnique.mockResolvedValue(comIngredientes);
      ocr.reconhecerRegioes.mockResolvedValue([' | ', 'Pomodoro', 'Basilico']);

      await processor.process(job());

      expect(catalogo.obterOuCriarIngrediente).not.toHaveBeenCalled();
      expect(prisma.menuItemIngrediente.createMany).not.toHaveBeenCalled();
      expect(prisma.menuItem.deleteMany).toHaveBeenCalled();
    });

    it('item apagado durante o OCR: não grava ingredientes nem enfileira nada', async () => {
      prisma.menuItem.findUnique.mockResolvedValue(comIngredientes);
      ocr.reconhecerRegioes.mockResolvedValue(['PIZZA', 'Pomodoro']);
      prisma.menuItem.updateMany.mockResolvedValue({ count: 0 });

      await processor.process(job());

      expect(prisma.menuItemIngrediente.createMany).not.toHaveBeenCalled();
      expect(filaDescricoes.addBulk).not.toHaveBeenCalled();
    });

    it('regiões inválidas no Json são ignoradas', async () => {
      prisma.menuItem.findUnique.mockResolvedValue({
        ...itemProcessando,
        regioesIngredientes: [{ x: 'a' }, null, 7, { x: 1, y: 2, largura: 3, altura: 4 }],
      });
      ocr.reconhecerRegioes.mockResolvedValue(['PIZZA', 'Pomodoro']);

      await processor.process(job());

      expect(ocr.reconhecerRegioes).toHaveBeenCalledWith(expect.any(Buffer), [
        { x: 1, y: 2, largura: 30, altura: 40 },
        { x: 1, y: 2, largura: 3, altura: 4 },
      ]);
    });
  });

  it('menu sem idioma usa "und" no catálogo', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({
      ...itemProcessando,
      menu: { ...itemProcessando.menu, idioma: null },
    });
    ocr.reconhecerRegioes.mockResolvedValue(['PIZZA']);

    await processor.process(job());

    expect(catalogo.obterOuCriar).toHaveBeenCalledWith('PIZZA', 'und');
  });

  it('recorte sem texto: apaga o item, não toca no catálogo nem nas filas', async () => {
    prisma.menuItem.findUnique.mockResolvedValue(itemProcessando);
    ocr.reconhecerRegioes.mockResolvedValue(['  |  ']);

    await processor.process(job());

    expect(prisma.menuItem.deleteMany).toHaveBeenCalledWith({
      where: { id: 'i1', status: 'PROCESSANDO' },
    });
    expect(catalogo.obterOuCriar).not.toHaveBeenCalled();
    expect(filaImagens.addBulk).not.toHaveBeenCalled();
    expect(eventos.publicar).toHaveBeenCalledWith({
      tipo: 'removido',
      menuId: 'm1',
    });
  });

  it('não conclui o menu enquanto sobram recortes PROCESSANDO', async () => {
    prisma.menuItem.findUnique.mockResolvedValue(itemProcessando);
    prisma.menuItem.count.mockResolvedValue(2);
    ocr.reconhecerRegioes.mockResolvedValue(['PIZZA']);

    await processor.process(job());

    expect(prisma.menu.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['o item não existe mais (lista reenviada)', null],
    ['o item já foi lido (retry)', { ...itemProcessando, status: 'PRONTO' }],
  ])('sai sem fazer nada quando %s', async (_caso, item) => {
    prisma.menuItem.findUnique.mockResolvedValue(item);

    await processor.process(job());

    expect(ocr.reconhecerRegioes).not.toHaveBeenCalled();
    expect(filaImagens.addBulk).not.toHaveBeenCalled();
  });

  it('item apagado durante o OCR: não enfileira a busca', async () => {
    prisma.menuItem.findUnique.mockResolvedValue(itemProcessando);
    ocr.reconhecerRegioes.mockResolvedValue(['PIZZA']);
    prisma.menuItem.updateMany.mockResolvedValue({ count: 0 });

    await processor.process(job());

    expect(filaImagens.addBulk).not.toHaveBeenCalled();
  });

  it('erro do OCR é relançado para o retry', async () => {
    prisma.menuItem.findUnique.mockResolvedValue(itemProcessando);
    ocr.reconhecerRegioes.mockRejectedValue(new Error('tesseract caiu'));

    await expect(processor.process(job())).rejects.toThrow('tesseract caiu');
  });

  describe('aoFalhar', () => {
    it('ainda há tentativas: não mexe no item', async () => {
      await processor.aoFalhar(job('i1', { attemptsMade: 1 }), new Error('x'));
      expect(prisma.menuItem.deleteMany).not.toHaveBeenCalled();
    });

    it('esgotou as tentativas: tira o item da lista e conclui o menu', async () => {
      prisma.menuItem.findUnique.mockResolvedValue({ menuId: 'm1' });

      await processor.aoFalhar(job('i1', { attemptsMade: 3 }), new Error('x'));

      expect(prisma.menuItem.deleteMany).toHaveBeenCalledWith({
        where: { id: 'i1', status: 'PROCESSANDO' },
      });
      expect(prisma.menu.updateMany).toHaveBeenCalled();
    });
  });
});
