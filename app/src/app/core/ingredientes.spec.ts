import { nomeEmPortugues } from './ingredientes';
import { IngredienteDoItem } from './menus-api.service';

const ing = (nomeOriginal: string, nomePt: string | null): IngredienteDoItem => ({
  id: 'i1',
  ordem: 0,
  nomeOriginal,
  ingrediente: { nomePt, descricao: null, descricaoUrl: null },
});

describe('nomeEmPortugues', () => {
  it('mostra o título em português quando difere do nome do cardápio', () => {
    expect(nomeEmPortugues(ing('pomodori', 'Tomate'))).toBe('Tomate');
  });

  it('não repete o nome quando só muda maiúscula ou acento', () => {
    expect(nomeEmPortugues(ing('gengibre', 'Gengibre'))).toBeNull();
    expect(nomeEmPortugues(ing('Oregano', 'Orégano'))).toBeNull();
  });

  it('sem título em português (sem artigo) ou sem ingrediente no catálogo: null', () => {
    expect(nomeEmPortugues(ing('raro', null))).toBeNull();
    expect(nomeEmPortugues({ id: 'i2', ordem: 1, nomeOriginal: 'x', ingrediente: null })).toBeNull();
  });
});
