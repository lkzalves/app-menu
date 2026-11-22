// 2400 px no lado maior: ainda lê o texto no OCR e passa folgado do limite de 10 MB da API
export const LADO_MAXIMO = 2400;
const QUALIDADE_JPEG = 0.85;

export interface FotoPreparada {
  blob: Blob;
  // Dimensões da foto que será enviada: os retângulos do 8.3 são em pixels dela
  largura: number;
  altura: number;
}

// Reduz mantendo a proporção; nunca aumenta
export function tamanhoAlvo(largura: number, altura: number, maximo = LADO_MAXIMO) {
  const maior = Math.max(largura, altura);
  if (maior <= maximo) return { largura, altura };
  const fator = maximo / maior;
  return { largura: Math.round(largura * fator), altura: Math.round(altura * fator) };
}

// Redesenha a foto num canvas e exporta JPEG. Isso aplica a rotação do EXIF (foto de celular em pé)
// e remove o EXIF: o que o usuário vê, o que o app calcula e o que a API recebe têm o mesmo tamanho
export async function prepararFoto(arquivo: File): Promise<FotoPreparada> {
  const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  try {
    const { largura, altura } = tamanhoAlvo(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível');
    ctx.drawImage(bitmap, 0, 0, largura, altura);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALIDADE_JPEG),
    );
    if (!blob) throw new Error('Não foi possível converter a imagem');
    return { blob, largura, altura };
  } finally {
    bitmap.close();
  }
}
