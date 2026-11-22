import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { separarIngredientes } from '../menus/ingredientes.util.js';
import { limparNomePrato } from '../menus/nome-prato.util.js';
import { TesseractOcrProvider } from './tesseract-ocr.provider.js';

const pasta = new URL('../../test/fixtures/cardapios/', import.meta.url);
const foto = fileURLToPath(new URL('fotos/comida.jpg', pasta));
const regioes: { x: number; y: number; largura: number; altura: number; nome: string }[] =
  JSON.parse(readFileSync(new URL('comida.regioes.json', pasta), 'utf8'));

// Compara sem maiúsculas, acentos e espaços extras (o OCR erra letras, mas o recorte deve acertar a maioria)
const normalizar = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Tesseract real, sem mock. A foto fica fora do git (direitos de imagem), então o teste é pulado sem ela.
describe.skipIf(!existsSync(foto))('TesseractOcrProvider.reconhecerRegioes (OCR real)', () => {
  it('lê o nome de cada prato circulado', async () => {
    const textos = await new TesseractOcrProvider().reconhecerRegioes(readFileSync(foto), regioes);
    const lidos = textos.map(limparNomePrato);

    expect(lidos).toHaveLength(regioes.length); // um texto por região, na mesma ordem
    const acertos = lidos.filter((nome, i) => normalizar(nome) === normalizar(regioes[i].nome));
    console.log(lidos.map((l, i) => `${regioes[i].nome} => ${l}`).join('\n'));
    // OCR não é exato: exige a maioria certa, não todos
    expect(acertos.length).toBeGreaterThanOrEqual(Math.ceil(regioes.length * 0.8));
  }, 120_000);

  it('lê e separa os ingredientes das linhas circuladas', async () => {
    const blocos: { prato: string; x: number; y: number; largura: number; altura: number; esperados: string[] }[] =
      JSON.parse(readFileSync(new URL('comida.ingredientes.json', pasta), 'utf8'));
    const textos = await new TesseractOcrProvider().reconhecerRegioes(readFileSync(foto), blocos);

    let esperados = 0;
    let achados = 0;
    blocos.forEach((bloco, i) => {
      const lidos = separarIngredientes(textos[i]).map(normalizar);
      console.log(`${bloco.prato} => ${separarIngredientes(textos[i]).join(' | ')}`);
      esperados += bloco.esperados.length;
      achados += bloco.esperados.filter((e) => lidos.includes(normalizar(e))).length;
    });
    // Texto pequeno e corrido: exige a maioria dos ingredientes esperados, não todos
    expect(achados).toBeGreaterThanOrEqual(Math.ceil(esperados * 0.7));
  }, 120_000);
});
