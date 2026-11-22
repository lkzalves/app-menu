import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { MenusApiService } from './menus-api.service';

describe('MenusApiService', () => {
  let api: MenusApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(MenusApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify()); // falha se sobrou requisição sem resposta

  it('criarMenu: POST /menus com o idioma', () => {
    api.criarMenu('it').subscribe((m) => expect(m.id).toBe('abc'));

    const req = http.expectOne(`${environment.apiUrl}/menus`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ idioma: 'it' });
    req.flush({ id: 'abc', idioma: 'it', fotoKey: null });
  });

  it('marcarPratos: POST /menus/:id/pratos com { grupos } (prato + ingredientes)', () => {
    const grupos = [
      {
        prato: { x: 10, y: 20, largura: 300, altura: 40 },
        ingredientes: [{ x: 10, y: 70, largura: 300, altura: 30 }],
      },
      { prato: { x: 10, y: 200, largura: 300, altura: 40 }, ingredientes: [] },
    ];
    api.marcarPratos('abc', grupos).subscribe((r) => expect(r.itens).toBe(2));

    const req = http.expectOne(`${environment.apiUrl}/menus/abc/pratos`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ grupos });
    req.flush({ itens: 2 });
  });

  it('urlDaFoto, urlDaImagem e urlDosEventos montam as URLs da API', () => {
    expect(api.urlDaFoto('abc')).toBe(`${environment.apiUrl}/menus/abc/foto`);
    expect(api.urlDaImagem('img1')).toBe(`${environment.apiUrl}/imagens/img1`);
    expect(api.urlDosEventos('abc')).toBe(`${environment.apiUrl}/menus/abc/eventos`);
  });

  it('naoEEsse: POST /menus/:id/itens/:itemId/nao-e-esse com a foto rejeitada', () => {
    api.naoEEsse('abc', 'it1', 'img1').subscribe((r) => expect(r.trocada).toBe(true));

    const req = http.expectOne(`${environment.apiUrl}/menus/abc/itens/it1/nao-e-esse`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ imagemId: 'img1' });
    req.flush({ trocada: true });
  });

  it('obterMenu: GET /menus/:id', () => {
    api.obterMenu('abc').subscribe((m) => expect(m.status).toBe('CONCLUIDO'));

    const req = http.expectOne(`${environment.apiUrl}/menus/abc`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 'abc', idioma: 'it', status: 'CONCLUIDO', itens: [] });
  });

  it('enviarFoto: POST multipart em /menus/:id/foto, no campo "foto"', () => {
    const foto = new Blob(['x'], { type: 'image/jpeg' });
    api.enviarFoto('abc', foto).subscribe();

    const req = http.expectOne(`${environment.apiUrl}/menus/abc/foto`);
    expect(req.request.method).toBe('POST');
    const corpo = req.request.body as FormData;
    expect(corpo).toBeInstanceOf(FormData);
    expect(corpo.get('foto')).toBeInstanceOf(File);
    expect((corpo.get('foto') as File).name).toBe('cardapio.jpg');
    req.flush({ id: 'abc', idioma: 'it', fotoKey: 'k' });
  });
});
