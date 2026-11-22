// Classe abstrata (e não interface) porque o Nest precisa de algo que exista em runtime
// para usar como token de injeção. Para trocar de OCR, basta outra classe que estenda esta.
export abstract class OcrProvider {
  // Recebe os bytes da imagem e devolve o texto bruto reconhecido
  abstract reconhecer(imagem: Buffer): Promise<string>;
}
