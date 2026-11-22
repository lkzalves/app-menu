import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, arrowUndo, remove } from 'ionicons/icons';
import { MenusApiService } from '../core/menus-api.service';
import { Ponto, Regiao, Tamanho, telaParaFoto, tracoParaRegiao } from '../core/regiao';

// Espessura do marca-texto na TELA, em px: com mais zoom ele cobre menos da foto (uma linha só)
const ESPESSURA_TELA = 28;
const COMPRIMENTO_MINIMO_TELA = 10; // traço menor que isso é toque acidental
const MAX_REGIOES = 30; // o mesmo limite da API
const ZOOM_MAXIMO = 4;

type Modo = 'marcar' | 'mover';

@Component({
  selector: 'app-marcar-pratos',
  templateUrl: 'marcar-pratos.page.html',
  styleUrls: ['marcar-pratos.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonContent,
    IonFooter,
    IonButtons,
    IonButton,
    IonIcon,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonSpinner,
  ],
})
export class MarcarPratosPage {
  private readonly api = inject(MenusApiService);
  private readonly toast = inject(ToastController);
  private readonly router = inject(Router);

  readonly menuId = inject(ActivatedRoute).snapshot.paramMap.get('id')!;
  // ?t=: a URL é a mesma depois de trocar a foto; sem isso o navegador poderia mostrar a antiga
  readonly urlFoto = `${this.api.urlDaFoto(this.menuId)}?t=${Date.now()}`;
  readonly espessura = ESPESSURA_TELA;

  // Tamanho REAL da foto (naturalWidth/Height): os retângulos são em pixels dela
  readonly foto = signal<Tamanho | null>(null);
  readonly erroFoto = signal(false);
  readonly regioes = signal<Regiao[]>([]);
  readonly traco = signal<Ponto[]>([]); // o traço em andamento, em pixels da foto
  readonly tracoSvg = computed(() => this.traco().map((p) => `${p.x},${p.y}`).join(' '));
  readonly modo = signal<Modo>('marcar');
  readonly zoom = signal(1);
  readonly enviando = signal(false);

  constructor() {
    // No Ionic standalone cada ícone precisa ser registrado, senão o <ion-icon> aparece vazio
    addIcons({ add, remove, arrowUndo });
  }

  aoCarregar(evento: Event) {
    const img = evento.target as HTMLImageElement;
    this.foto.set({ largura: img.naturalWidth, altura: img.naturalHeight });
  }

  mudarModo(valor: unknown) {
    if (valor === 'marcar' || valor === 'mover') this.modo.set(valor);
  }

  mudarZoom(delta: number) {
    this.zoom.update((z) => Math.min(ZOOM_MAXIMO, Math.max(1, z + delta)));
  }

  // --- Gesto: pointer events servem para mouse e dedo ---

  aoPressionar(evento: PointerEvent) {
    if (this.modo() !== 'marcar' || !this.foto()) return;
    // Captura: continua recebendo o movimento mesmo se o dedo sair da camada
    (evento.currentTarget as Element).setPointerCapture(evento.pointerId);
    this.traco.set([this.ponto(evento)]);
  }

  aoMover(evento: PointerEvent) {
    if (this.traco().length === 0) return;
    this.traco.update((t) => [...t, this.ponto(evento)]);
  }

  async aoSoltar(evento: PointerEvent) {
    const foto = this.foto();
    const pontos = this.traco();
    this.traco.set([]);
    if (!foto || pontos.length === 0) return;

    // Quantos pixels da foto vale 1 px da tela agora (muda com o zoom)
    const caixa = (evento.currentTarget as Element).getBoundingClientRect();
    const escala = foto.largura / caixa.width;
    const regiao = tracoParaRegiao(pontos, ESPESSURA_TELA * escala, foto, COMPRIMENTO_MINIMO_TELA * escala);
    if (!regiao) return;

    if (this.regioes().length >= MAX_REGIOES) {
      await this.avisar(`No máximo ${MAX_REGIOES} pratos por vez.`);
      return;
    }
    this.regioes.update((r) => [...r, regiao]);
  }

  aoCancelar() {
    this.traco.set([]); // o navegador tomou o gesto (ex.: rolagem): descarta o traço
  }

  private ponto(evento: PointerEvent): Ponto {
    const caixa = (evento.currentTarget as Element).getBoundingClientRect();
    return telaParaFoto(evento.clientX, evento.clientY, caixa, this.foto()!);
  }

  // --- Lista de regiões ---

  desfazer() {
    this.regioes.update((r) => r.slice(0, -1));
  }

  remover(indice: number) {
    this.regioes.update((r) => r.filter((_, i) => i !== indice));
  }

  async enviar() {
    const regioes = this.regioes();
    if (regioes.length === 0) return;

    this.enviando.set(true);
    try {
      await firstValueFrom(this.api.marcarPratos(this.menuId, regioes));
      // Os itens já existem (PROCESSANDO); a lista abre o SSE e mostra os pratos conforme ficam prontos
      await this.router.navigate(['/menus', this.menuId]);
    } catch {
      // As regiões continuam na tela para tentar de novo
      await this.avisar('Não foi possível enviar. Confira a conexão e tente de novo.');
    } finally {
      this.enviando.set(false);
    }
  }

  voltar() {
    return this.router.navigate(['/novo-menu']);
  }

  private async avisar(mensagem: string) {
    const aviso = await this.toast.create({ message: mensagem, duration: 4000, color: 'danger' });
    await aviso.present();
  }
}
