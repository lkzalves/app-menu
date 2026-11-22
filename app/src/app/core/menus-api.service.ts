import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { Regiao } from './regiao';

// Só o que o app usa da resposta de POST /menus e POST /menus/:id/foto
export interface MenuCriado {
  id: string;
  idioma: string | null;
  fotoKey: string | null;
}

// --- GET /menus/:id: só os campos que o app usa ---

export type StatusMenu = 'RECEBIDO' | 'PROCESSANDO' | 'CONCLUIDO' | 'ERRO';
export type StatusItem = 'PROCESSANDO' | 'PRONTO'; // PROCESSANDO = esqueleto, nomeOriginal vazio
export type FonteImagem = 'PIXABAY' | 'WIKIMEDIA' | 'BRAVE';

export interface ImagemDoPrato {
  id: string; // a foto sai de GET /imagens/:id
  fonte: FonteImagem;
  paginaOrigem: string | null;
  credito: string | null;
  licenca: string | null;
}

export interface PratoDoCatalogo {
  descricao: string | null; // só existe quando há artigo em português na Wikipédia
  descricaoUrl: string | null;
  imagens: ImagemDoPrato[];
}

export interface ItemDoMenu {
  id: string;
  ordem: number;
  status: StatusItem;
  nomeOriginal: string;
  dishId: string | null;
  dish: PratoDoCatalogo | null;
}

export interface MenuDetalhe {
  id: string;
  idioma: string | null;
  status: StatusMenu;
  itens: ItemDoMenu[];
}

@Injectable({ providedIn: 'root' })
export class MenusApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // A foto como o servidor a tem: é nela que o app desenha, então os pixels batem com o OCR
  urlDaFoto(menuId: string) {
    return `${this.base}/menus/${menuId}/foto`;
  }

  // Foto ilustrativa de um prato (id do DishImage), para usar direto no <img src>
  urlDaImagem(imagemId: string) {
    return `${this.base}/imagens/${imagemId}`;
  }

  // Stream SSE do menu (EventSource)
  urlDosEventos(menuId: string) {
    return `${this.base}/menus/${menuId}/eventos`;
  }

  obterMenu(menuId: string) {
    return this.http.get<MenuDetalhe>(`${this.base}/menus/${menuId}`);
  }

  // 202: o OCR de cada recorte roda depois (os nomes chegam pelos eventos)
  marcarPratos(menuId: string, regioes: Regiao[]) {
    return this.http.post<{ itens: number }>(`${this.base}/menus/${menuId}/pratos`, { regioes });
  }

  criarMenu(idioma: string) {
    return this.http.post<MenuCriado>(`${this.base}/menus`, { idioma });
  }

  // Multipart, campo "foto" (é o que o FileInterceptor da API espera)
  enviarFoto(menuId: string, foto: Blob) {
    const corpo = new FormData();
    corpo.append('foto', foto, 'cardapio.jpg');
    return this.http.post<MenuCriado>(`${this.base}/menus/${menuId}/foto`, corpo);
  }
}
