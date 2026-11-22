import { Job, Worker } from 'bullmq';
import { LimiteExcedidoError } from '../fila/limite-excedido.error.js';
import { ImagensProcessor } from './imagens.processor.js';

const job = { data: { dishId: 'd1', nome: 'Tiramisu', idioma: 'it' } } as Job<{
  dishId: string;
  nome: string;
  idioma: string;
}>;

describe('ImagensProcessor', () => {
  const imagens = { garantirImagem: vi.fn() };
  const eventos = { publicar: vi.fn() };
  const rateLimit = vi.fn();
  let processor: ImagensProcessor;

  beforeEach(() => {
    imagens.garantirImagem.mockReset();
    rateLimit.mockReset();
    eventos.publicar.mockReset();
    processor = new ImagensProcessor(imagens as never, eventos as never);
    // O worker real só existe dentro do Nest; aqui basta o que o processor usa
    Object.defineProperty(processor, 'worker', { get: () => ({ rateLimit }) });
  });

  it('chama o service com os dados do job e devolve o resultado', async () => {
    imagens.garantirImagem.mockResolvedValue(true);
    expect(await processor.process(job)).toBe(true);
    expect(eventos.publicar).toHaveBeenCalledWith({
      tipo: 'imagem',
      dishId: 'd1',
    });
    expect(imagens.garantirImagem).toHaveBeenCalledWith('d1', 'Tiramisu', 'it');
  });

  it('limite da Pixabay pausa a fila e devolve o job', async () => {
    imagens.garantirImagem.mockRejectedValue(
      new LimiteExcedidoError('Pixabay', 30_000),
    );
    await expect(processor.process(job)).rejects.toThrow(
      Worker.RateLimitError(),
    );
    expect(rateLimit).toHaveBeenCalledWith(30_000);
  });

  it('sem resultado (false) não publica evento', async () => {
    imagens.garantirImagem.mockResolvedValue(false);
    await processor.process(job);
    expect(eventos.publicar).not.toHaveBeenCalled();
  });

  it('erro comum é relançado para o retry', async () => {
    imagens.garantirImagem.mockRejectedValue(new Error('rede caiu'));
    await expect(processor.process(job)).rejects.toThrow('rede caiu');
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
