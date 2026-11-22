import { MAX_INGREDIENTES, separarIngredientes } from './ingredientes.util.js';

describe('separarIngredientes', () => {
  it('separa por vírgula e pelo "e" final', () => {
    expect(separarIngredientes('Pomodoro, mozzarella di bufala e basilico')).toEqual([
      'Pomodoro',
      'mozzarella di bufala',
      'basilico',
    ]);
  });

  it('junta as linhas e a palavra hifenizada na quebra', () => {
    expect(separarIngredientes('Aliche de pro-\ndução artesanal,\nTomates Cereja Assados')).toEqual([
      'Aliche de produção artesanal',
      'Tomates Cereja Assados',
    ]);
  });

  it('tira parênteses, preço e peso', () => {
    expect(separarIngredientes('Babaghanoush (purê de berinjelas assadas), Tomates Secos R$37 250g')).toEqual([
      'Babaghanoush',
      'Tomates Secos',
    ]);
  });

  it('"com" também separa e a preposição que sobra no início sai', () => {
    expect(separarIngredientes('Creme de Queijo Boursin com Laranja e Missô, de pesca sustentável')).toEqual([
      'Creme de Queijo Boursin',
      'Laranja',
      'Missô',
      'pesca sustentável',
    ]);
  });

  it('aceita conectivos em outros idiomas e outros separadores', () => {
    expect(separarIngredientes('tomate y cebolla; ham and cheese • basilico ed olio / sale')).toEqual([
      'tomate',
      'cebolla',
      'ham',
      'cheese',
      'basilico',
      'olio',
      'sale',
    ]);
  });

  it('não quebra palavras que contêm "e" ou "com"', () => {
    expect(separarIngredientes('Queijo Parmesão, Cogumelos')).toEqual(['Queijo Parmesão', 'Cogumelos']);
  });

  it('descarta lixo do OCR e repetidos (sem acento e maiúsculas)', () => {
    expect(separarIngredientes('| Tomate, —, a, TOMATE, tomaté *')).toEqual(['Tomate']);
  });

  it(`limita a ${MAX_INGREDIENTES} ingredientes de até 60 caracteres`, () => {
    const muitos = Array.from({ length: 20 }, (_, i) => `ingrediente ${String.fromCharCode(97 + i)}`).join(', ');
    expect(separarIngredientes(muitos)).toHaveLength(MAX_INGREDIENTES);
    expect(separarIngredientes('x'.repeat(100))[0]).toHaveLength(60);
  });

  it.each([[''], ['   '], ['12,50 R$46']])('%j vira lista vazia', (texto) => {
    expect(separarIngredientes(texto)).toEqual([]);
  });
});
