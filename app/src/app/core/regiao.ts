// Tudo aqui é em pixels da foto (origem no canto superior esquerdo), que é o que a API espera
export interface Ponto {
  x: number;
  y: number;
}

export interface Tamanho {
  largura: number;
  altura: number;
}

// Retângulo inteiro, no formato do corpo de POST /menus/:id/pratos
export interface Regiao {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

// Posição e tamanho da foto na tela (getBoundingClientRect)
export interface CaixaNaTela {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Posição do dedo na tela → pixel da foto. A foto aparece reduzida (ou ampliada pelo zoom),
// então multiplica pela razão entre o tamanho real e o tamanho exibido
export function telaParaFoto(clientX: number, clientY: number, caixa: CaixaNaTela, foto: Tamanho): Ponto {
  return {
    x: ((clientX - caixa.left) * foto.largura) / caixa.width,
    y: ((clientY - caixa.top) * foto.altura) / caixa.height,
  };
}

// Traço do dedo → retângulo que envolve o nome do prato.
// Passar o dedo sobre uma linha de texto dá um traço quase sem altura: a `espessura` (a do marca-texto,
// já em pixels da foto) dá meia espessura de folga em cada lado. Devolve null se o traço foi curto
// demais (toque acidental). `comprimentoMinimo` também é em pixels da foto
export function tracoParaRegiao(
  pontos: Ponto[],
  espessura: number,
  foto: Tamanho,
  comprimentoMinimo: number,
): Regiao | null {
  if (pontos.length === 0) return null;

  const xs = pontos.map((p) => p.x);
  const ys = pontos.map((p) => p.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  if (Math.max(maxX - minX, maxY - minY) < comprimentoMinimo) return null;

  const folga = espessura / 2;
  // floor/ceil: a região só cresce ao virar inteiro; clamp: nunca sai da foto
  const esquerda = Math.max(0, Math.floor(minX - folga));
  const topo = Math.max(0, Math.floor(minY - folga));
  const direita = Math.min(foto.largura, Math.ceil(maxX + folga));
  const base = Math.min(foto.altura, Math.ceil(maxY + folga));

  const largura = direita - esquerda;
  const altura = base - topo;
  if (largura < 1 || altura < 1) return null; // traço todo fora da foto
  return { x: esquerda, y: topo, largura, altura };
}
