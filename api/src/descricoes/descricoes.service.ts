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
}
