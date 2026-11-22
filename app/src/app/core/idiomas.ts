export interface Idioma {
  codigo: string; // vai para Menu.idioma na API
  nome: string;
}

// Só os idiomas que o OCR (Tesseract) lê hoje: por+eng+spa+ita. Cresce quando entrar o Google Vision
export const IDIOMAS: Idioma[] = [
  { codigo: 'pt', nome: 'Português' },
  { codigo: 'en', nome: 'English' },
  { codigo: 'es', nome: 'Español' },
  { codigo: 'it', nome: 'Italiano' },
];
