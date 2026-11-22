import { Worker } from 'bullmq';
import { LimiteExcedidoError, tratarLimite } from './limite-excedido.error.js';

describe('tratarLimite', () => {
  it('limite da fonte: pausa a fila pelo tempo pedido e lança o RateLimitError do BullMQ', async () => {
    const worker = { rateLimit: vi.fn() };

    await expect(
      tratarLimite(worker, new LimiteExcedidoError('Wikipedia', 21_000)),
    ).rejects.toThrow(Worker.RateLimitError());
    expect(worker.rateLimit).toHaveBeenCalledWith(21_000);
  });

  it('outro erro é relançado como está, sem pausar a fila (vira retry normal)', async () => {
    const worker = { rateLimit: vi.fn() };
    const erro = new Error('rede caiu');

    await expect(tratarLimite(worker, erro)).rejects.toBe(erro);
    expect(worker.rateLimit).not.toHaveBeenCalled();
  });
});
