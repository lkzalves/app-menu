import {
  MAX_INGREDIENTES_POR_PRATO,
  adicionarIngrediente,
  adicionarPrato,
  desfazer,
  motivoSemIngrediente,
  removerIngrediente,
  removerPrato,
} from './grupos';
import { GrupoPrato, Regiao } from './regiao';

const r = (x: number): Regiao => ({ x, y: 0, largura: 10, altura: 10 });
const grupo = (x: number, ...ingredientes: number[]): GrupoPrato => ({ prato: r(x), ingredientes: ingredientes.map(r) });

describe('grupos de prato e ingredientes', () => {
  it('adicionarPrato cria um grupo sem ingredientes, sem mexer na lista original', () => {
    const antes = [grupo(1)];
    const depois = adicionarPrato(antes, r(2));
    expect(depois).toEqual([grupo(1), grupo(2)]);
    expect(antes).toEqual([grupo(1)]);
  });

  it('adicionarIngrediente liga ao ÚLTIMO prato, na ordem da marcação', () => {
    let g = adicionarPrato([], r(1));
    g = adicionarIngrediente(g, r(10));
    g = adicionarPrato(g, r(2));
    g = adicionarIngrediente(g, r(20));
    g = adicionarIngrediente(g, r(21));
    expect(g).toEqual([grupo(1, 10), grupo(2, 20, 21)]);
  });

  it('adicionarIngrediente sem prato antes não muda nada', () => {
    expect(adicionarIngrediente([], r(10))).toEqual([]);
  });

  it('desfazer tira o último ingrediente e só depois o prato (ordem inversa da marcação)', () => {
    let g = [grupo(1, 10), grupo(2, 20, 21)];
    g = desfazer(g);
    expect(g).toEqual([grupo(1, 10), grupo(2, 20)]);
    g = desfazer(g);
    expect(g).toEqual([grupo(1, 10), grupo(2)]);
    g = desfazer(g); // o prato 2 não tem mais ingredientes: sai ele
    expect(g).toEqual([grupo(1, 10)]);
    expect(desfazer(desfazer(desfazer(g)))).toEqual([]); // vazio continua vazio
  });

  it('removerPrato leva os ingredientes dele junto e mantém os outros', () => {
    expect(removerPrato([grupo(1, 10), grupo(2, 20), grupo(3)], 1)).toEqual([grupo(1, 10), grupo(3)]);
  });

  it('removerIngrediente tira só aquela linha daquele prato', () => {
    const g = [grupo(1, 10, 11), grupo(2, 20)];
    expect(removerIngrediente(g, 0, 0)).toEqual([grupo(1, 11), grupo(2, 20)]);
    expect(g).toEqual([grupo(1, 10, 11), grupo(2, 20)]); // original intacto
  });

  it('motivoSemIngrediente: sem prato, no limite, ou liberado', () => {
    expect(motivoSemIngrediente([])).toBe('sem-prato');
    const cheio = grupo(1, ...Array.from({ length: MAX_INGREDIENTES_POR_PRATO }, (_, i) => i));
    expect(motivoSemIngrediente([cheio])).toBe('limite');
    expect(motivoSemIngrediente([cheio, grupo(2)])).toBeNull(); // o limite é por prato, e vale o último
    expect(motivoSemIngrediente([grupo(1, 10)])).toBeNull();
  });
});
