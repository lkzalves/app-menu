import { telaParaFoto, tracoParaRegiao } from './regiao';

const FOTO = { largura: 1000, altura: 1000 };

describe('telaParaFoto', () => {
  it('converte a posição na tela para pixels da foto, descontando a borda', () => {
    // Foto de 2000 px mostrada com 500 px de largura (escala 4), começando em (10, 20)
    const caixa = { left: 10, top: 20, width: 500, height: 250 };
    const ponto = telaParaFoto(260, 145, caixa, { largura: 2000, altura: 1000 });
    expect(ponto).toEqual({ x: 1000, y: 500 });
  });

  it('com zoom a escala diminui: a mesma posição na tela cai em outro pixel', () => {
    // Mesma foto ampliada 2x (1000 px de largura exibidos): cada pixel da tela vale 2 da foto
    const caixa = { left: 0, top: 0, width: 1000, height: 500 };
    expect(telaParaFoto(300, 100, caixa, { largura: 2000, altura: 1000 })).toEqual({ x: 600, y: 200 });
  });
});

describe('tracoParaRegiao', () => {
  it('traço horizontal fino (sem altura) ganha a altura da espessura do marca-texto', () => {
    const r = tracoParaRegiao([{ x: 100, y: 200 }, { x: 500, y: 200 }], 40, FOTO, 10);
    expect(r).toEqual({ x: 80, y: 180, largura: 440, altura: 40 });
  });

  it('a direção do traço não importa (da direita para a esquerda dá a mesma região)', () => {
    const ida = tracoParaRegiao([{ x: 100, y: 200 }, { x: 500, y: 200 }], 40, FOTO, 10);
    const volta = tracoParaRegiao([{ x: 500, y: 200 }, { x: 100, y: 200 }], 40, FOTO, 10);
    expect(volta).toEqual(ida);
  });

  it('nome em duas linhas: a região envolve o traço inteiro', () => {
    const r = tracoParaRegiao(
      [{ x: 100, y: 200 }, { x: 400, y: 200 }, { x: 100, y: 260 }, { x: 300, y: 260 }],
      40,
      FOTO,
      10,
    );
    expect(r).toEqual({ x: 80, y: 180, largura: 340, altura: 100 });
  });

  it('não sai da foto: limita nas quatro bordas', () => {
    const r = tracoParaRegiao([{ x: 5, y: 5 }, { x: 990, y: 990 }], 40, FOTO, 10);
    expect(r).toEqual({ x: 0, y: 0, largura: 1000, altura: 1000 });
  });

  it('traço que começa fora da foto (dedo na margem) é limitado', () => {
    const r = tracoParaRegiao([{ x: -30, y: 100 }, { x: 50, y: 100 }], 40, FOTO, 10);
    expect(r).toEqual({ x: 0, y: 80, largura: 70, altura: 40 });
  });

  it('descarta toque e traço curto demais', () => {
    expect(tracoParaRegiao([{ x: 100, y: 100 }], 40, FOTO, 10)).toBeNull();
    expect(tracoParaRegiao([{ x: 100, y: 100 }, { x: 104, y: 103 }], 40, FOTO, 10)).toBeNull();
    expect(tracoParaRegiao([], 40, FOTO, 10)).toBeNull();
  });

  it('descarta traço todo fora da foto', () => {
    expect(tracoParaRegiao([{ x: -500, y: -500 }, { x: -300, y: -300 }], 40, FOTO, 10)).toBeNull();
  });

  it('só devolve inteiros, e a região nunca encolhe por causa do arredondamento', () => {
    const r = tracoParaRegiao([{ x: 100.4, y: 200.6 }, { x: 300.7, y: 200.6 }], 41, FOTO, 10)!;
    for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
    expect(r.x).toBeLessThanOrEqual(100.4 - 20.5);
    expect(r.x + r.largura).toBeGreaterThanOrEqual(300.7 + 20.5);
  });
});
