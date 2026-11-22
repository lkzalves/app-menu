import { normalizarNome, semArtigo } from './normalizar-nome.util.js';

describe('semArtigo', () => {
  it.each([
    ['LE MELANZANE', 'MELANZANE'],
    ["L'Insalata Mista", 'Insalata Mista'],
    ['The Burger', 'Burger'],
    ['Açaí na tigela', 'Açaí na tigela'], // sem artigo: mantém acento e caixa
    ['  Il   Tiramisù ', 'Tiramisù'],
    ['LE', 'LE'], // só um artigo: não esvazia
    ['La Pasta La Vista', 'Pasta La Vista'], // só o primeiro
  ])('%j vira %j', (entrada, esperado) => {
    expect(semArtigo(entrada)).toBe(esperado);
  });
});

describe('normalizarNome', () => {
  it.each([
    ['LE MELANZANE', 'melanzane'],
    ['I GAMBERI', 'gamberi'],
    ['IL PROSCIUTTO ROSOLATO', 'prosciutto rosolato'],
    ["L'Insalata Mista", 'insalata mista'],
    ['Crème Brûlée', 'creme brulee'], // acentos
    ['  Pizza   Margherita! ', 'pizza margherita'], // espaços e pontuação
    ['Pizza 4 Formaggi', 'pizza 4 formaggi'], // número é do nome
    ['Los Tacos', 'tacos'],
    ['The Burger', 'burger'],
    ['TAGLIERE MISTO', 'tagliere misto'],
    ['Pizza (grande)', 'pizza grande'],
  ])('%j vira %j', (entrada, esperado) => {
    expect(normalizarNome(entrada)).toBe(esperado);
  });

  it('só tira o artigo do início, uma vez', () => {
    expect(normalizarNome('La Pasta La Vista')).toBe('pasta la vista');
  });

  it('não esvazia o nome quando ele é só um artigo', () => {
    expect(normalizarNome('LE')).toBe('le');
  });

  it.each([[''], ['  '], ['|—*']])('%j vira vazio', (entrada) => {
    expect(normalizarNome(entrada)).toBe('');
  });
});
