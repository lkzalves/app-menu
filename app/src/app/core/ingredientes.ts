import { IngredienteDoItem } from './menus-api.service';

// Minúsculas e sem acento, para comparar "Pomodoro" com "pomodoro" e "Orégano" com "oregano"
const comparavel = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

// Nome em português para mostrar entre parênteses, só quando difere do que está no cardápio
// ("pomodori (Tomate)", mas só "Gengibre" quando já é o mesmo nome). Null = não mostra
export function nomeEmPortugues(ing: IngredienteDoItem): string | null {
  const pt = ing.ingrediente?.nomePt;
  return pt && comparavel(pt) !== comparavel(ing.nomeOriginal) ? pt : null;
}
