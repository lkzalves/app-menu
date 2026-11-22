import { idiomaPixabay, tagsCombinam } from './pixabay.util.js';

describe('idiomaPixabay', () => {
  it.each([
    ['it', 'it'],
    ['IT', 'it'],
    ['pt-BR', 'pt'],
    ['zh', 'zh'],
    ['und', 'en'], // indeterminado
    ['xx', 'en'], // fora dos 26
    ['', 'en'],
    [null, 'en'],
    [undefined, 'en'],
  ])('%j vira %j', (entrada, esperado) => {
    expect(idiomaPixabay(entrada)).toBe(esperado);
  });
});

describe('tagsCombinam', () => {
  it('aceita quando uma tag contém uma palavra do prato', () => {
    expect(tagsCombinam('tiramisu, dessert, coffee', 'Il Tiramisù')).toBe(true);
    expect(tagsCombinam('pizza, italian food', 'Pizza Margherita')).toBe(true);
  });

  it('rejeita quando nenhuma tag tem relação', () => {
    expect(tagsCombinam('sunset, beach, sea', 'Tiramisù')).toBe(false);
  });

  it('ignora palavras curtas do nome ("di", "al")', () => {
    expect(tagsCombinam('dinner, table, dish', 'Spaghetti al Pomodoro')).toBe(false);
  });

  it('não depende de acento nem de caixa', () => {
    expect(tagsCombinam('Acai, Bowl', 'AÇAÍ na tigela')).toBe(true);
  });
});
