import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WikipediaProvider } from './wikipedia.provider.js';

// Prato sem artigo só é consultado de novo depois deste prazo
const REVALIDAR_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class DescricoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wikipedia: WikipediaProvider,
  ) {}

  // Garante a descrição do prato no catálogo. Devolve false se não há (ainda) descrição
  async garantirDescricao(dishId: string, nome: string, idioma: string): Promise<boolean> {
    const dish = await this.prisma.dish.findUnique({
      where: { id: dishId },
      select: { descricao: true, descricaoBuscadaEm: true },
    });
    if (!dish) return false;
    if (dish.descricao) return true; // cache compartilhado: prato resolvido uma vez serve para todos

    // Já tentamos há pouco e não havia artigo: não insiste
    const { descricaoBuscadaEm } = dish;
    if (descricaoBuscadaEm && Date.now() - descricaoBuscadaEm.getTime() < REVALIDAR_MS) return false;

    // Se o provider lançar (rede, HTTP 5xx, 429), nada é gravado e a próxima chamada tenta de novo
    const achada = await this.wikipedia.buscar(nome, idioma);
    await this.prisma.dish.update({
      where: { id: dishId },
      data: {
        descricao: achada?.texto ?? null,
        descricaoUrl: achada?.url ?? null,
        descricaoBuscadaEm: new Date(), // marca a tentativa, com ou sem resultado
      },
    });
    return achada !== null;
  }

  // Descrição de todos os ingredientes do item que ainda não têm (uma consulta em lote). Devolve o id do
  // menu quando achou alguma descrição nova (para o worker avisar o app), senão null
  async garantirIngredientes(itemId: string): Promise<string | null> {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: itemId },
      select: {
        menuId: true,
        menu: { select: { idioma: true } },
        ingredientes: {
          select: {
            nomeOriginal: true,
            ingrediente: { select: { id: true, descricao: true, descricaoBuscadaEm: true } },
          },
        },
      },
    });
    if (!item) return null;

    // Pendente = sem descrição e sem tentativa recente. Cache compartilhado: "tomate" resolvido uma vez
    // serve para todos os cardápios
    const pendentes = new Map<string, string>(); // ingredienteId → nome como o cardápio escreveu
    for (const { nomeOriginal, ingrediente } of item.ingredientes) {
      if (!ingrediente || ingrediente.descricao || pendentes.has(ingrediente.id)) continue;
      const tentou = ingrediente.descricaoBuscadaEm;
      if (tentou && Date.now() - tentou.getTime() < REVALIDAR_MS) continue;
      pendentes.set(ingrediente.id, nomeOriginal);
    }
    if (pendentes.size === 0) return null;

    // Se o provider lançar (rede, HTTP 5xx, 429), nada é gravado e o retry refaz o lote inteiro
    const achadas = await this.wikipedia.buscarVarios([...pendentes.values()], item.menu.idioma ?? 'und');

    let achouAlguma = false;
    for (const [ingredienteId, nome] of pendentes) {
      const achada = achadas.get(nome);
      achouAlguma ||= achada !== undefined;
      await this.prisma.ingrediente.updateMany({
        where: { id: ingredienteId, descricao: null }, // não pisa numa descrição que outro job acabou de gravar
        data: {
          nomePt: achada?.nomePt ?? null,
          descricao: achada?.texto ?? null,
          descricaoUrl: achada?.url ?? null,
          descricaoBuscadaEm: new Date(), // marca a tentativa, com ou sem resultado
        },
      });
    }
    return achouAlguma ? item.menuId : null;
  }
}
