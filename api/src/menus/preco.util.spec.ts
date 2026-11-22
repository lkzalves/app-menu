import { normalizarPreco } from './preco.util.js';

describe('normalizarPreco', () => {
  it.each([
    [12.5, '12.5'],
    ['12.5', '12.5'],
    ['12,5', '12.5'],
    ['12,50', '12.50'],
    ['R$ 12,50', '12.50'],
    ['€12.50', '12.50'],
    ['1.234,50', '1234.50'],
    ['1,234.50', '1234.50'],
    ['1.234', '1234'],
    ['1.234.567', '1234567'],
    ['12', '12'],
    ['12,', '12'],
  ])('%j vira %j', (entrada, esperado) => {
    expect(normalizarPreco(entrada)).toBe(esperado);
  });

  it.each([['abc'], ['-5'], [null], [{}]])('mantém %j como veio (inválido)', (entrada) => {
    expect(normalizarPreco(entrada)).toBe(entrada);
  });

  it('mantém undefined', () => {
    expect(normalizarPreco(undefined)).toBeUndefined();
  });
});
