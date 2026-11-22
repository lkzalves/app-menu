import { vi } from 'vitest';
import { TipoEvento, abrirEventos } from './eventos-sse';

// EventSource falso: guarda os ouvintes para o teste disparar os eventos à mão
class EventSourceFalso {
  static ultimo: EventSourceFalso;
  onerror: (() => void) | null = null;
  fechado = false;
  private readonly ouvintes = new Map<string, () => void>();

  constructor(readonly url: string) {
    EventSourceFalso.ultimo = this;
  }

  addEventListener(tipo: string, ouvinte: () => void) {
    this.ouvintes.set(tipo, ouvinte);
  }

  close() {
    this.fechado = true;
  }

  emitir(tipo: string) {
    this.ouvintes.get(tipo)?.();
  }
}

describe('abrirEventos', () => {
  beforeEach(() => vi.stubGlobal('EventSource', EventSourceFalso));
  afterEach(() => vi.unstubAllGlobals());

  it('abre o EventSource na URL e repassa o tipo de cada evento', () => {
    const recebidos: TipoEvento[] = [];
    abrirEventos('http://api/menus/1/eventos').subscribe((t) => recebidos.push(t));

    const origem = EventSourceFalso.ultimo;
    expect(origem.url).toBe('http://api/menus/1/eventos');
    for (const tipo of ['ready', 'item', 'removido', 'menu', 'imagem', 'descricao']) origem.emitir(tipo);

    expect(recebidos).toEqual(['ready', 'item', 'removido', 'menu', 'imagem', 'descricao']);
  });

  it('ignora o ping e emite "erro" quando a conexão cai', () => {
    const recebidos: TipoEvento[] = [];
    abrirEventos('http://api/x').subscribe((t) => recebidos.push(t));

    const origem = EventSourceFalso.ultimo;
    origem.emitir('ping'); // sem ouvinte: nada acontece
    origem.onerror?.();

    expect(recebidos).toEqual(['erro']);
  });

  it('cancelar a inscrição fecha a conexão', () => {
    const assinatura = abrirEventos('http://api/x').subscribe();
    const origem = EventSourceFalso.ultimo;
    expect(origem.fechado).toBe(false);

    assinatura.unsubscribe();
    expect(origem.fechado).toBe(true);
  });
});
