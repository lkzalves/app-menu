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
