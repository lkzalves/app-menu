import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizarNome } from './normalizar-nome.util.js';

// Medido em pares reais: erros de OCR ("igamberi" × "gamberi") ficam acima disto nos dois critérios;
// pratos diferentes que começam igual ("frittatina" × "frittatina bolognese") caem na proporção de tamanho.
const SIMILARIDADE_MINIMA = 0.5;
const PROPORCAO_TAMANHO_MINIMA = 0.75;

interface Candidato {
  dishId: string;
  nomeNormalizado: string;
  similaridade: number;
}

@Injectable()
export class CatalogoService {
  constructor(private readonly prisma: PrismaService) {}

  // Acha o prato parecido com este nome no idioma, ou null. Devolve o id do Dish
  async buscar(nome: string, idioma: string): Promise<string | null> {
    const normalizado = normalizarNome(nome);
    if (!normalizado) return null;

    // O operador % usa o índice trigram e já descarta o que tem similaridade < 0,3 (padrão do pg_trgm)
    const candidatos = await this.prisma.$queryRaw<Candidato[]>`
      SELECT "dishId", "nomeNormalizado", similarity("nomeNormalizado", ${normalizado}) AS "similaridade"
      FROM "DishName"
      WHERE "idioma" = ${idioma} AND "nomeNormalizado" % ${normalizado}
      ORDER BY "similaridade" DESC
      LIMIT 5`;

    const melhor = candidatos.find(
      (c) =>
        c.similaridade >= SIMILARIDADE_MINIMA &&
        Math.min(c.nomeNormalizado.length, normalizado.length) /
          Math.max(c.nomeNormalizado.length, normalizado.length) >=
          PROPORCAO_TAMANHO_MINIMA,
    );
    return melhor?.dishId ?? null;
  }

  // Devolve o id do prato, criando Dish + DishName se ainda não existir nenhum parecido
  async obterOuCriar(nome: string, idioma: string): Promise<string> {
    const normalizado = normalizarNome(nome);
    if (!normalizado) throw new Error('Nome do prato sem letras ou números');

    const existente = await this.buscar(nome, idioma);
    if (existente) return existente;

    try {
      const dish = await this.prisma.dish.create({
        data: { nomes: { create: { nome, nomeNormalizado: normalizado, idioma } } },
      });
      return dish.id;
    } catch (e) {
      // P2002 = violou o @@unique: outra requisição criou este mesmo nome agora há pouco
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const criado = await this.prisma.dishName.findUnique({
          where: { idioma_nomeNormalizado: { idioma, nomeNormalizado: normalizado } },
        });
        if (criado) return criado.dishId;
      }
      throw e;
    }
  }

  // Mesma ideia para ingredientes, mas só por nome normalizado EXATO (sem similaridade: nomes curtos
  // e parecidos, como "pepe" e "pere", são ingredientes diferentes). Devolve o id do Ingrediente
  async obterOuCriarIngrediente(nome: string, idioma: string): Promise<string> {
    const normalizado = normalizarNome(nome);
    if (!normalizado) throw new Error('Nome do ingrediente sem letras ou números');

    const chave = { idioma_nomeNormalizado: { idioma, nomeNormalizado: normalizado } };
    const existente = await this.prisma.ingredienteNome.findUnique({ where: chave });
    if (existente) return existente.ingredienteId;

    try {
      const ingrediente = await this.prisma.ingrediente.create({
        data: { nomes: { create: { nome, nomeNormalizado: normalizado, idioma } } },
      });
      return ingrediente.id;
    } catch (e) {
      // P2002: outro job criou o mesmo nome agora há pouco
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const criado = await this.prisma.ingredienteNome.findUnique({ where: chave });
        if (criado) return criado.ingredienteId;
      }
      throw e;
    }
  }
}
