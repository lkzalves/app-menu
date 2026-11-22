import {
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  share,
  startWith,
  switchMap,
} from 'rxjs';
import { TipoEvento, abrirEventos } from './eventos-sse';
import { MenuDetalhe, MenusApiService } from './menus-api.service';

export interface EstadoAoVivo {
  menu: MenuDetalhe | null; // null até o primeiro GET responder
  semConexao: boolean;
}

// Mantém o menu em dia: a cada evento do SSE refaz GET /menus/:id. Os eventos são só avisos,
// então perder um não quebra nada; ao reconectar a API manda 'ready' e o app ressincroniza.
// `eventos$` e `esperaMs` são parâmetros só para os testes poderem trocá-los
export function acompanharMenu(
  api: MenusApiService,
  menuId: string,
  eventos$: Observable<TipoEvento> = abrirEventos(api.urlDosEventos(menuId)),
  esperaMs = 150,
): Observable<EstadoAoVivo> {
  const eventos = eventos$.pipe(share()); // uma conexão só, usada pelos dois ramos abaixo

  const semConexao$ = eventos.pipe(
    map((tipo) => tipo === 'erro'),
    startWith(false),
    distinctUntilChanged(),
  );

  const menu$ = eventos.pipe(
    filter((tipo) => tipo !== 'erro'),
    debounceTime(esperaMs), // vários pratos chegando juntos viram um GET só
    // switchMap cancela o GET anterior se outro evento chegou; GET com erro não derruba o stream
    switchMap(() => api.obterMenu(menuId).pipe(catchError(() => EMPTY))),
    startWith<MenuDetalhe | null>(null),
  );

  return combineLatest([menu$, semConexao$]).pipe(map(([menu, semConexao]) => ({ menu, semConexao })));
}
