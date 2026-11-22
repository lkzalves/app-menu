import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, firstValueFrom, merge } from 'rxjs';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonProgressBar,
  IonSkeletonText,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { restaurantOutline } from 'ionicons/icons';
import { EstadoAoVivo, acompanharMenu } from '../core/acompanhar-menu';
import { TipoEvento, abrirEventos } from '../core/eventos-sse';
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
    IonSpinner,
    RouterLink,
  ],
})
export class ListaPratosPage {
  private readonly api = inject(MenusApiService);
  private readonly toast = inject(ToastController);

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

  // Ids das fotos com "não é esse prato" em andamento (o botão daquela foto fica desabilitado)
  readonly rejeitando = signal<ReadonlySet<string>>(new Set());

  // Força um novo GET além dos eventos do servidor. Se a foto já tinha sido rejeitada antes, a API responde
  // trocada=false e não publica evento: sem isso a tela desatualizada continuaria mostrando a foto
  private readonly atualizar$ = new Subject<TipoEvento>();

  constructor() {
    // No Ionic standalone cada ícone precisa ser registrado, senão o <ion-icon> aparece vazio
    addIcons({ restaurantOutline });

    // Abre o SSE e refaz o GET a cada evento; fecha a conexão quando a página é destruída
    const eventos$ = merge(abrirEventos(this.api.urlDosEventos(this.menuId)), this.atualizar$);
    acompanharMenu(this.api, this.menuId, eventos$)
      .pipe(takeUntilDestroyed())
      .subscribe((estado) => this.estado.set(estado));
  }

  // Até 3 fotos ativas do prato (a API já limita); sem nenhuma, a tela mostra um ícone neutro
  fotos(item: ItemDoMenu): ImagemDoPrato[] {
    return item.dish?.imagens ?? [];
  }

  urlDaImagem(imagemId: string) {
    return this.api.urlDaImagem(imagemId);
  }

  // "Não é esse prato" numa foto: a API a rejeita e busca outra só para aquela vaga
  async naoEEsse(item: ItemDoMenu, foto: ImagemDoPrato) {
    if (this.rejeitando().has(foto.id)) return;
    this.marcarRejeitando(foto.id, true);

    let aviso: { mensagem: string; cor: string };
    try {
      await firstValueFrom(this.api.naoEEsse(this.menuId, item.id, foto.id));
      this.atualizar$.next('imagem');
      aviso = { mensagem: 'Foto removida. Buscando outra…', cor: 'medium' };
    } catch {
      aviso = { mensagem: 'Não foi possível remover a foto. Tente de novo.', cor: 'danger' };
    } finally {
      this.marcarRejeitando(foto.id, false);
    }
    await this.avisar(aviso.mensagem, aviso.cor);
  }

  private marcarRejeitando(imagemId: string, ligado: boolean) {
    this.rejeitando.update((atual) => {
      const novo = new Set(atual);
      if (ligado) novo.add(imagemId);
      else novo.delete(imagemId);
      return novo;
    });
  }

  private async avisar(mensagem: string, cor: string) {
    const aviso = await this.toast.create({ message: mensagem, duration: 3000, color: cor });
    await aviso.present();
  }
}
