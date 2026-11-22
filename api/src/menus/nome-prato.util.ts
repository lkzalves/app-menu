// Preço colado no fim do recorte: "R$46", "Rs23", "R547" ($ lido como 5), "2537" (R$ lido como 25), "12,50"
const PRECO_NO_FIM = /(?:^|\s+)[\p{L}$€£]{0,3}\s*(?:\d{2,}|\d+[.,]\d{1,2})$/u;
// Lixo nas pontas: "|", "—", "*", ícones que o OCR lê como símbolo
const LIXO_NAS_PONTAS = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

// Texto cru do OCR de um recorte → só o nome do prato
export function limparNomePrato(texto: string): string {
  const nome = texto.replace(/\s+/g, ' ').replace(LIXO_NAS_PONTAS, '');
  return nome.replace(PRECO_NO_FIM, '').replace(LIXO_NAS_PONTAS, '');
}
