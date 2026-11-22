import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { camera } from 'ionicons/icons';
import { IDIOMAS } from '../core/idiomas';
import { MenusApiService } from '../core/menus-api.service';
import { FotoPreparada, prepararFoto } from '../core/preparar-foto';

@Component({
  selector: 'app-novo-menu',
  templateUrl: 'novo-menu.page.html',
  styleUrls: ['novo-menu.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonIcon,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonSpinner,
  ],
})
export class NovoMenuPage implements OnDestroy {
  private readonly api = inject(MenusApiService);
  private readonly toast = inject(ToastController);
  private readonly router = inject(Router);

  readonly idiomas = IDIOMAS;

  readonly foto = signal<FotoPreparada | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly idioma = signal<string | null>(null);
  readonly preparando = signal(false);
  readonly enviando = signal(false);
  // Guardado entre tentativas: se o upload falhar, tentar de novo não cria outro menu
  readonly menuId = signal<string | null>(null);

  constructor() {
    // No Ionic standalone cada ícone precisa ser registrado, senão o <ion-icon> aparece vazio
    addIcons({ camera });
  }

  async aoEscolherArquivo(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const arquivo = input.files?.[0];
    input.value = ''; // permite escolher o mesmo arquivo de novo
    if (!arquivo) return;

    this.preparando.set(true);
    try {
      const foto = await prepararFoto(arquivo);
      this.liberarPreview();
      this.foto.set(foto);
      this.previewUrl.set(URL.createObjectURL(foto.blob));
    } catch {
      await this.avisar('Não foi possível ler esta imagem. Tente outra foto.');
    } finally {
      this.preparando.set(false);
    }
  }

  aoMudarIdioma(codigo: string) {
    this.idioma.set(codigo);
    this.menuId.set(null); // o menu já criado teria o idioma antigo
  }

  async continuar() {
    const foto = this.foto();
    const idioma = this.idioma();
    if (!foto || !idioma) return;

    this.enviando.set(true);
    try {
      let id = this.menuId();
      if (!id) {
        id = (await firstValueFrom(this.api.criarMenu(idioma))).id;
        this.menuId.set(id);
      }
      await firstValueFrom(this.api.enviarFoto(id, foto.blob));
      // A tela de marcar busca a foto no servidor (GET /menus/:id/foto): só o id vai na rota
      await this.router.navigate(['/menus', id, 'marcar']);
    } catch {
      await this.avisar('Não foi possível enviar. Confira a conexão e tente de novo.');
    } finally {
      this.enviando.set(false);
    }
  }

  ngOnDestroy() {
    this.liberarPreview();
  }

  // O blob: URL ocupa memória até ser revogado
  private liberarPreview() {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }

  private async avisar(mensagem: string) {
    const aviso = await this.toast.create({ message: mensagem, duration: 4000, color: 'danger' });
    await aviso.present();
  }
}
