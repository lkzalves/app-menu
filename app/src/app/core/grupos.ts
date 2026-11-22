import { GrupoPrato, Regiao } from './regiao';

// Os mesmos limites da API (GrupoPratoDto / MarcarPratosDto)
export const MAX_PRATOS = 30;
export const MAX_INGREDIENTES_POR_PRATO = 5;

// O vínculo é pela ordem: o ingrediente circulado vai para o ÚLTIMO prato da lista.
// Funções puras (devolvem uma lista nova), para testar sem a tela

export function adicionarPrato(grupos: GrupoPrato[], prato: Regiao): GrupoPrato[] {
  return [...grupos, { prato, ingredientes: [] }];
}

// Sem nenhum prato antes, não há a quem ligar: a lista volta como estava (a tela avisa antes)
export function adicionarIngrediente(grupos: GrupoPrato[], regiao: Regiao): GrupoPrato[] {
  if (grupos.length === 0) return grupos;
  const ultimo = grupos[grupos.length - 1];
  return [...grupos.slice(0, -1), { ...ultimo, ingredientes: [...ultimo.ingredientes, regiao] }];
}

// Desfaz o último traço, na ordem inversa da marcação: o último ingrediente do último prato
// ou, se ele não tem ingredientes, o próprio prato
export function desfazer(grupos: GrupoPrato[]): GrupoPrato[] {
  if (grupos.length === 0) return grupos;
  const ultimo = grupos[grupos.length - 1];
  if (ultimo.ingredientes.length === 0) return grupos.slice(0, -1);
  return [...grupos.slice(0, -1), { ...ultimo, ingredientes: ultimo.ingredientes.slice(0, -1) }];
}

// Remover um prato leva os ingredientes dele junto
export function removerPrato(grupos: GrupoPrato[], indice: number): GrupoPrato[] {
  return grupos.filter((_, i) => i !== indice);
}

export function removerIngrediente(grupos: GrupoPrato[], indicePrato: number, indiceIngrediente: number): GrupoPrato[] {
  return grupos.map((g, i) =>
    i === indicePrato ? { ...g, ingredientes: g.ingredientes.filter((_, j) => j !== indiceIngrediente) } : g,
  );
}

// Dá para circular mais uma linha de ingredientes? Devolve o motivo de não dar, ou null
export function motivoSemIngrediente(grupos: GrupoPrato[]): 'sem-prato' | 'limite' | null {
  if (grupos.length === 0) return 'sem-prato';
  return grupos[grupos.length - 1].ingredientes.length >= MAX_INGREDIENTES_POR_PRATO ? 'limite' : null;
}
