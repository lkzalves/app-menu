import { Job, Worker } from 'bullmq';
import { LimiteExcedidoError } from '../fila/limite-excedido.error.js';
import { DescricoesProcessor } from './descricoes.processor.js';

const job = { data: { dishId: 'd1', nome: 'Tiramisu', idioma: 'it' } } as Job<{
  dishId: string;
  nome: string;
  idioma: string;
}>;

describe('DescricoesProcessor', () => {
  const descricoes = { garantirDescricao: vi.fn(), garantirIngredientes: vi.fn() };
  const eventos = { publicar: vi.fn() };
  const rateLimit = vi.fn();
  let processor: DescricoesProcessor;

  beforeEach(() => {
    descricoes.garantirDescricao.mockReset();
    descricoes.garantirIngredientes.mockReset();
    rateLimit.mockReset();
    eventos.publicar.mockReset();
    processor = new DescricoesProcessor(descricoes as never, eventos as never);
    // O worker real só existe dentro do Nest; aqui basta o que o processor usa
    Object.defineProperty(processor, 'worker', { get: () => ({ rateLimit }) });
  });

  it('chama o service com os dados do job e devolve o resultado', async () => {
    descricoes.garantirDescricao.mockResolvedValue(true);
    expect(await processor.process(job)).toBe(true);
    expect(eventos.publicar).toHaveBeenCalledWith({
      tipo: 'descricao',
      dishId: 'd1',
    });
    expect(descricoes.garantirDescricao).toHaveBeenCalledWith(
      'd1',
      'Tiramisu',
      'it',
    );
  });

  it('limite da Wikipedia pausa a fila e devolve o job', async () => {
    descricoes.garantirDescricao.mockRejectedValue(
      new LimiteExcedidoError('Wikipedia', 30_000),
    );
    await expect(processor.process(job)).rejects.toThrow(
      Worker.RateLimitError(),
    );
    expect(rateLimit).toHaveBeenCalledWith(30_000);
  });

  describe('job "ingredientes"', () => {
    const jobIng = { name: 'ingredientes', data: { itemId: 'i1' } } as Job<{ itemId: string }>;

    it('chama o service com o item e avisa o app do menu quando achou descrição', async () => {
      descricoes.garantirIngredientes.mockResolvedValue('m1');
      expect(await processor.process(jobIng as never)).toBe(true);
      expect(descricoes.garantirIngredientes).toHaveBeenCalledWith('i1');
      expect(descricoes.garantirDescricao).not.toHaveBeenCalled();
      expect(eventos.publicar).toHaveBeenCalledWith({ tipo: 'ingrediente', menuId: 'm1' });
    });

    it('nada novo (null): não publica evento', async () => {
      descricoes.garantirIngredientes.mockResolvedValue(null);
      expect(await processor.process(jobIng as never)).toBe(false);
      expect(eventos.publicar).not.toHaveBeenCalled();
    });

    it('limite da Wikipedia pausa a fila; erro comum é relançado', async () => {
      descricoes.garantirIngredientes.mockRejectedValueOnce(new LimiteExcedidoError('Wikipedia', 30_000));
      await expect(processor.process(jobIng as never)).rejects.toThrow(Worker.RateLimitError());
      expect(rateLimit).toHaveBeenCalledWith(30_000);

      descricoes.garantirIngredientes.mockRejectedValueOnce(new Error('rede caiu'));
      await expect(processor.process(jobIng as never)).rejects.toThrow('rede caiu');
    });
  });

  it('sem resultado (false) não publica evento', async () => {
    descricoes.garantirDescricao.mockResolvedValue(false);
    await processor.process(job);
    expect(eventos.publicar).not.toHaveBeenCalled();
  });

  it('erro comum é relançado para o retry', async () => {
    descricoes.garantirDescricao.mockRejectedValue(new Error('rede caiu'));
    await expect(processor.process(job)).rejects.toThrow('rede caiu');
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
