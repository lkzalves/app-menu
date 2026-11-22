import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { EstadoAoVivo, acompanharMenu } from './acompanhar-menu';
import { TipoEvento } from './eventos-sse';
import { MenuDetalhe, MenusApiService } from './menus-api.service';

const URL_MENU = 'http://localhost:3000/menus/m1';
const menu = (status: MenuDetalhe['status'] = 'PROCESSANDO'): MenuDetalhe => ({
  id: 'm1',
  idioma: 'it',
  status,
  itens: [],
});

describe('acompanharMenu', () => {
  let http: HttpTestingController;
  let eventos: Subject<TipoEvento>;
  let estados: EstadoAoVivo[];

  const iniciar = () =>
    acompanharMenu(TestBed.inject(MenusApiService), 'm1', eventos, 150).subscribe((e) => estados.push(e));
  const ultimo = () => estados[estados.length - 1];

  beforeEach(() => {
    vi.useFakeTimers(); // o debounce usa timer: o teste avança o relógio à mão
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    eventos = new Subject<TipoEvento>();
    estados = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('começa sem menu e sem aviso de conexão, e não faz GET antes de um evento', () => {
    iniciar();
    expect(ultimo()).toEqual({ menu: null, semConexao: false });
    http.expectNone(URL_MENU);
  });

  it('uma rajada de eventos vira um GET só', () => {
    iniciar();
    eventos.next('ready');
    eventos.next('item');
    eventos.next('item');
    vi.advanceTimersByTime(149);
    http.expectNone(URL_MENU); // ainda dentro da janela do debounce

    vi.advanceTimersByTime(1);
    http.expectOne(URL_MENU).flush(menu());
    expect(ultimo().menu?.id).toBe('m1');
  });

  it('um evento novo depois dispara outro GET e atualiza o menu', () => {
    iniciar();
    eventos.next('ready');
    vi.advanceTimersByTime(150);
    http.expectOne(URL_MENU).flush(menu('PROCESSANDO'));

    eventos.next('menu');
    vi.advanceTimersByTime(150);
    http.expectOne(URL_MENU).flush(menu('CONCLUIDO'));
    expect(ultimo().menu?.status).toBe('CONCLUIDO');
  });

  it('GET com erro não derruba o stream: o próximo evento ainda atualiza', () => {
    iniciar();
    eventos.next('ready');
    vi.advanceTimersByTime(150);
    http.expectOne(URL_MENU).flush('falhou', { status: 500, statusText: 'Erro' });
    expect(ultimo().menu).toBeNull();

    eventos.next('imagem');
    vi.advanceTimersByTime(150);
    http.expectOne(URL_MENU).flush(menu());
    expect(ultimo().menu?.id).toBe('m1');
  });

  it('erro da conexão liga o aviso; o próximo "ready" desliga e refaz o GET', () => {
    iniciar();
    eventos.next('erro');
    expect(ultimo().semConexao).toBe(true);
    http.expectNone(URL_MENU); // "erro" não é motivo para buscar o menu

    eventos.next('ready');
    expect(ultimo().semConexao).toBe(false);
    vi.advanceTimersByTime(150);
    http.expectOne(URL_MENU).flush(menu());
  });

  it('cancelar a inscrição solta o stream de eventos', () => {
    const assinatura = iniciar();
    expect(eventos.observed).toBe(true);
    assinatura.unsubscribe();
    expect(eventos.observed).toBe(false);
  });
});
