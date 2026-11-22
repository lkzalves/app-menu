import { Observable } from 'rxjs';

// Tipos de evento que a API manda (o "ping" a cada 25 s só mantém a conexão viva e é ignorado)
export const TIPOS_EVENTO = ['ready', 'item', 'removido', 'menu', 'imagem', 'descricao'] as const;

// 'erro' não vem da API: é a conexão que caiu (o EventSource tenta reconectar sozinho,
// e ao reconectar a API manda 'ready' de novo)
export type TipoEvento = (typeof TIPOS_EVENTO)[number] | 'erro';

// EventSource como Observable: cada evento vira o seu tipo. Os eventos são só avisos, sem dados.
// Cancelar a inscrição fecha a conexão
export function abrirEventos(url: string): Observable<TipoEvento> {
  return new Observable<TipoEvento>((assinante) => {
    const origem = new EventSource(url);
    for (const tipo of TIPOS_EVENTO) {
      origem.addEventListener(tipo, () => assinante.next(tipo));
    }
    origem.onerror = () => assinante.next('erro');
    return () => origem.close();
  });
}
