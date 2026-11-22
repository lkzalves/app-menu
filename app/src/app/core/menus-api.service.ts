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

@Injectable({ providedIn: 'root' })
export class MenusApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // A foto como o servidor a tem: é nela que o app desenha, então os pixels batem com o OCR
  urlDaFoto(menuId: string) {
    return `${this.base}/menus/${menuId}/foto`;
  }

  // 202: o OCR de cada recorte roda depois (os nomes chegam pelos eventos, no 8.4)
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
