import { limparNomePrato } from './nome-prato.util.js';

describe('limparNomePrato', () => {
  it.each([
    // Casos do OCR real do cardápio da Itaglio
    ['| GAMBERI R$48', 'GAMBERI'],
    ['PATATINE FRITTE Rs23', 'PATATINE FRITTE'],
    ['IL TARTARE R547', 'IL TARTARE'],
    ['LE PATATINE TARTUFATE 2537', 'LE PATATINE TARTUFATE'],
    ['TAGLIERE\nMISTO R$46\n', 'TAGLIERE MISTO'],
    ['# LE MELANZANE R$ 37', 'LE MELANZANE'],
    // Outros formatos de preço
    ['Lasanha 12,50', 'Lasanha'],
    ['Burger €9,50', 'Burger'],
    ['Pizza Margherita', 'Pizza Margherita'], // sem preço: não mexe
    ['Pizza 4 Formaggi', 'Pizza 4 Formaggi'], // número no meio é do nome
    ['  Crème   brûlée  ', 'Crème brûlée'], // espaços repetidos e acentos
  ])('%j vira %j', (entrada, esperado) => {
    expect(limparNomePrato(entrada)).toBe(esperado);
  });

  it.each([[''], ['  \n '], ['R$46'], ['|—*']])('%j não vira nome (vazio)', (entrada) => {
    expect(limparNomePrato(entrada)).toBe('');
  });
});
