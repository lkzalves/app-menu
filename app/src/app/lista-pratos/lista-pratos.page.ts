import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonProgressBar,
  IonSkeletonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { restaurantOutline } from 'ionicons/icons';
import { EstadoAoVivo, acompanharMenu } from '../core/acompanhar-menu';
import { nomeDaFonte } from '../core/fonte-imagem';
import { ImagemDoPrato, ItemDoMenu, MenusApiService } from '../core/menus-api.service';

@Component({
  selector: 'app-lista-pratos',
  templateUrl: 'lista-pratos.page.html',
  styleUrls: ['lista-pratos.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonIcon,
    IonProgressBar,
    IonSkeletonText,
    RouterLink,
  ],
})
export class ListaPratosPage {
  private readonly api = inject(MenusApiService);

  readonly menuId = inject(ActivatedRoute).snapshot.paramMap.get('id')!;
  readonly nomeDaFonte = nomeDaFonte;

  readonly estado = signal<EstadoAoVivo>({ menu: null, semConexao: false });
  readonly itens = computed(() => this.estado().menu?.itens ?? []);
  // Barra de progresso: antes do primeiro GET ou enquanto ainda há recortes sendo lidos
  readonly lendo = computed(() => {
    const menu = this.estado().menu;
    return menu === null || menu.status === 'PROCESSANDO';
  });
  // OCR terminou e nenhum recorte virou nome de prato
  readonly vazio = computed(() => {
    const menu = this.estado().menu;
    return menu?.status === 'CONCLUIDO' && menu.itens.length === 0;
  });

  constructor() {
    // No Ionic standalone cada ícone precisa ser registrado, senão o <ion-icon> aparece vazio
    addIcons({ restaurantOutline });

    // Abre o SSE e refaz o GET a cada evento; fecha a conexão quando a página é destruída
    acompanharMenu(this.api, this.menuId)
      .pipe(takeUntilDestroyed())
      .subscribe((estado) => this.estado.set(estado));
  }

  // A primeira foto ativa do prato; sem foto ainda (ou nenhuma fonte achou), a tela mostra um ícone
  foto(item: ItemDoMenu): ImagemDoPrato | null {
    return item.dish?.imagens[0] ?? null;
  }

  urlDaImagem(imagemId: string) {
    return this.api.urlDaImagem(imagemId);
  }
}
