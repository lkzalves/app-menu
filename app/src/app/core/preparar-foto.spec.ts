import { tamanhoAlvo } from './preparar-foto';

describe('tamanhoAlvo', () => {
  it('não mexe em foto que já cabe no limite', () => {
    expect(tamanhoAlvo(1600, 1200)).toEqual({ largura: 1600, altura: 1200 });
  });

  it('não aumenta foto pequena', () => {
    expect(tamanhoAlvo(300, 200, 2400)).toEqual({ largura: 300, altura: 200 });
  });

  it('paisagem: reduz o lado maior (largura) e mantém a proporção', () => {
    expect(tamanhoAlvo(4800, 3200)).toEqual({ largura: 2400, altura: 1600 });
  });

  it('retrato: reduz o lado maior (altura) e mantém a proporção', () => {
    expect(tamanhoAlvo(3000, 4000)).toEqual({ largura: 1800, altura: 2400 });
  });

  it('arredonda para pixels inteiros', () => {
    const { largura, altura } = tamanhoAlvo(4001, 3001, 2000);
    expect(Number.isInteger(largura)).toBe(true);
    expect(Number.isInteger(altura)).toBe(true);
    expect(largura).toBe(2000);
  });
});
