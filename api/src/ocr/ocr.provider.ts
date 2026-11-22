// Retângulo da foto, em pixels da imagem enviada (origem no canto superior esquerdo)
export interface Regiao {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

// Classe abstrata (e não interface) porque o Nest precisa de algo que exista em runtime
// para usar como token de injeção. Para trocar de OCR, basta outra classe que estenda esta.
export abstract class OcrProvider {
  // Recebe os bytes da imagem e devolve o texto bruto reconhecido
  abstract reconhecer(imagem: Buffer): Promise<string>;

  // Lê só os retângulos pedidos. Devolve um texto por região, na mesma ordem
  abstract reconhecerRegioes(imagem: Buffer, regioes: Regiao[]): Promise<string[]>;
}
