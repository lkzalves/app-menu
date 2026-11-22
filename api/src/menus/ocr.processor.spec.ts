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
  };
  const fotos = { getBuffer: vi.fn() };
  const ocr = { reconhecerRegioes: vi.fn() };
  const catalogo = { obterOuCriar: vi.fn() };
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
