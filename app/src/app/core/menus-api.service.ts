import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

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
