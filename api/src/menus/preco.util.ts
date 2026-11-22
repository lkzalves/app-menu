// Converte preços de cardápio ("12,50", "R$ 12,50", "1.234,50") em string com ponto ("12.50").
// Se não der para interpretar, devolve o valor original e a validação do DTO responde 400.
export function normalizarPreco(valor: unknown): unknown {
  if (typeof valor === 'number') return String(valor); // número do JSON já usa ponto
  if (typeof valor !== 'string' || valor.includes('-')) return valor;

  const limpo = valor.replace(/[^\d.,]/g, ''); // tira R$, €, espaços...
  if (!/\d/.test(limpo)) return valor;

  const ultimoPonto = limpo.lastIndexOf('.');
  const ultimaVirgula = limpo.lastIndexOf(',');
  let posDecimal = -1;

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    // Os dois aparecem: o último é o decimal, o outro é milhar
    posDecimal = Math.max(ultimoPonto, ultimaVirgula);
  } else if (ultimoPonto >= 0 || ultimaVirgula >= 0) {
    const sep = ultimoPonto >= 0 ? '.' : ',';
    const pos = Math.max(ultimoPonto, ultimaVirgula);
    const repetido = limpo.indexOf(sep) !== pos;
    const tresDigitosDepois = limpo.length - pos - 1 === 3;
    // Repetido ("1.234.567") ou 3 dígitos depois ("1.234") = milhar (convenção pt-BR)
    if (!repetido && !tresDigitosDepois) posDecimal = pos;
  }

  if (posDecimal < 0) return limpo.replace(/[.,]/g, '');
  const inteiro = limpo.slice(0, posDecimal).replace(/[.,]/g, '') || '0';
  const fracao = limpo.slice(posDecimal + 1);
  return fracao ? `${inteiro}.${fracao}` : inteiro;
}
