import { idiomaWikipedia, limparExtrato, variacoesTitulo } from './wikipedia.util.js';

describe('idiomaWikipedia', () => {
  it.each([
    ['it', 'it'],
    ['IT', 'it'],
    ['pt-BR', 'pt'],
    ['haw', 'haw'], // códigos de 3 letras existem
    ['und', null], // indeterminado
    ['', null],
    [null, null],
    [undefined, null],
    ['x', null],
    ['it.evil.com/', null], // vira parte do host: nada fora de 2–3 letras passa
    ['__e2e_ds__', null],
  ])('%j vira %j', (entrada, esperado) => {
    expect(idiomaWikipedia(entrada)).toBe(esperado);
  });
});

describe('variacoesTitulo', () => {
  it.each([
    ['TIRAMISÙ', ['Tiramisù']], // tudo maiúsculo: não tenta o nome como veio
    ['LE MELANZANE', ['Melanzane']], // sem artigo
    ['PIZZA MARGHERITA', ['Pizza margherita', 'Pizza Margherita']],
    ['Pizza Margherita', ['Pizza Margherita', 'Pizza margherita']], // grafia original primeiro
    ['Frittata di Pasta', ['Frittata di Pasta', 'Frittata di pasta', 'Frittata Di Pasta']],
    ['Tiramisù', ['Tiramisù']], // as três grafias são iguais
    ["L'Insalata Mista", ['Insalata Mista', 'Insalata mista']],
    ['Açaí  na   tigela', ['Açaí na tigela', 'Açaí Na Tigela']],
  ])('%j vira %j', (entrada, esperado) => {
    expect(variacoesTitulo(entrada)).toEqual(esperado);
  });

  it('tira caracteres que não valem em título (a API separa títulos por "|")', () => {
    expect(variacoesTitulo('Pizza | Bomba #1')).toEqual(['Pizza Bomba 1', 'Pizza bomba 1']);
  });

  it('normaliza para NFC (a API avisa quando não está)', () => {
    const decomposto = 'Tiramisù'; // u + acento separado
    expect(variacoesTitulo(decomposto)).toEqual(['Tiramisù']);
  });

  it.each([[''], ['  '], ['|#']])('%j vira lista vazia', (entrada) => {
    expect(variacoesTitulo(entrada)).toEqual([]);
  });
});

describe('limparExtrato', () => {
  it('tira parênteses vazios e de pronúncia', () => {
    expect(limparExtrato('Il tiramisù () è un dolce (pronuncia: [x]) molto noto.')).toBe(
      'Il tiramisù è un dolce molto noto.',
    );
  });

  it('tira parênteses aninhados', () => {
    expect(limparExtrato('A moqueca (do tupi (opokeka) ou quimbundo) é um cozido.')).toBe('A moqueca é um cozido.');
  });

  it('troca quebras de linha e espaços repetidos por um espaço', () => {
    expect(limparExtrato('Primeira frase.\nSegunda   frase.')).toBe('Primeira frase. Segunda frase.');
  });

  it('mantém o texto curto como está', () => {
    expect(limparExtrato('Um prato simples.')).toBe('Um prato simples.');
  });

  it('corta em até 300 caracteres, terminando numa frase inteira quando dá', () => {
    const frase = 'Esta é uma frase de tamanho razoável para o teste.'; // 50 caracteres
    const r = limparExtrato(`${frase} ${frase} ${frase} ${frase} ${frase} ${frase} ${frase}`);
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r.endsWith('teste.')).toBe(true);
  });

  it('sem fim de frase por perto, corta numa palavra inteira e põe reticências', () => {
    const r = limparExtrato('palavra '.repeat(60)); // 480 caracteres, sem ponto
    expect(r.length).toBeLessThanOrEqual(301);
    expect(r.endsWith('palavra…')).toBe(true);
  });

  it('texto vazio continua vazio', () => {
    expect(limparExtrato('')).toBe('');
    expect(limparExtrato(' () ')).toBe('');
  });
});
