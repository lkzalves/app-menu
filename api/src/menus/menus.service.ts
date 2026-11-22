import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDisk, serveFile, StorageDisk } from '@nestjs/storage';
import { Prisma } from '../generated/prisma/client.js';
import { Queue } from 'bullmq';
import {
  DadosJobDescricao,
  DadosJobOcr,
  DadosJobPrato,
  FILA_DESCRICOES,
  FILA_IMAGENS,
  FILA_OCR,
  jobsDePratos,
  OPCOES_JOB_PRATO,
} from '../fila/fila.constants.js';
import { EventosService } from '../eventos/eventos.service.js';
import { FOTOS_POR_PRATO } from '../imagens/imagens.constants.js';
import { OcrProvider } from '../ocr/ocr.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMenuItemDto } from './dto/create-menu-item.dto.js';
import { CreateMenuDto } from './dto/create-menu.dto.js';
import { GrupoPratoDto } from './dto/marcar-pratos.dto.js';

// Votos "não é esse prato" para tirar uma foto do ar. O catálogo é compartilhado: com vários
// usuários (etapa 9), subir este número ou contar por dispositivo
const LIMITE_VOTOS_NEGATIVOS = 1;

@Injectable()
export class MenusService {
  // O Nest injeta a única instância do PrismaService
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
    @InjectDisk('fotos') private readonly fotos: StorageDisk,
    private readonly ocr: OcrProvider,
    @InjectQueue(FILA_OCR) private readonly filaOcr: Queue<DadosJobOcr>,
    @InjectQueue(FILA_IMAGENS) private readonly filaImagens: Queue<DadosJobPrato>,
    @InjectQueue(FILA_DESCRICOES) private readonly filaDescricoes: Queue<DadosJobDescricao>,
  ) {}

  create(dto: CreateMenuDto) {
    return this.prisma.menu.create({ data: dto });
  }

  findAll() {
    return this.prisma.menu.findMany({ orderBy: { criadoEm: 'desc' } });
  }

  async findOne(id: string) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      include: {
        itens: {
          orderBy: { ordem: 'asc' },
          // Fotos ativas do prato, só com o que o app precisa (o arquivo sai por GET /imagens/:id)
          include: {
            // Ingredientes na ordem do cardápio; a descrição vem do catálogo (pode ainda não existir)
            ingredientes: {
              orderBy: { ordem: 'asc' },
              select: {
                id: true,
                ordem: true,
                nomeOriginal: true,
                ingrediente: { select: { nomePt: true, descricao: true, descricaoUrl: true } },
              },
            },
            dish: {
              select: {
                descricao: true,
                descricaoUrl: true, // crédito: "Fonte: Wikipédia" com este link
                imagens: {
                  where: { ativa: true },
                  orderBy: { criadoEm: 'asc' },
                  take: FOTOS_POR_PRATO, // proteção para pratos antigos com mais fotos
                  select: { id: true, fonte: true, paginaOrigem: true, credito: true, licenca: true },
                },
              },
            },
          },
        },
      },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado'); // vira HTTP 404
    return menu;
  }

  // Enfileira a busca de foto de cada prato (1 job por prato; o worker faz o trabalho). O worker de OCR
  // já faz isso sozinho; este endpoint serve para reprocessar. O jobId fixo por prato evita duplicar
  async buscarImagens(id: string) {
    const { idioma, pratos } = await this.pratosDoMenu(id);
    await this.filaImagens.addBulk(jobsDePratos('imagem', pratos.map((p) => ({ ...p, idioma }))));
    return { pratos: pratos.length };
  }

  // Mesma ideia para a descrição (Wikipedia)
  async buscarDescricoes(id: string) {
    const { idioma, pratos } = await this.pratosDoMenu(id);
    await this.filaDescricoes.addBulk(jobsDePratos('descricao', pratos.map((p) => ({ ...p, idioma }))));
    return { pratos: pratos.length };
  }

  // Pratos distintos do menu (dois itens do mesmo prato compartilham foto e descrição) e o idioma
  private async pratosDoMenu(id: string) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: {
        idioma: true,
        itens: { orderBy: { ordem: 'asc' }, select: { dishId: true, nomeOriginal: true } },
      },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado');

    const vistos = new Set<string>();
    const pratos: { dishId: string; nome: string }[] = [];
    for (const item of menu.itens) {
      if (!item.dishId || vistos.has(item.dishId)) continue;
      vistos.add(item.dishId);
      pratos.push({ dishId: item.dishId, nome: item.nomeOriginal });
    }
    return { idioma: menu.idioma ?? 'und', pratos };
  }

  // O arquivo já foi gravado pelo interceptor antes de chegar aqui
  async anexarFoto(id: string, key: string) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: { fotoKey: true },
    });
    if (!menu) {
      await this.fotos.delete(key); // não deixa arquivo órfão
      throw new NotFoundException('Menu não encontrado');
    }
    const atualizado = await this.prisma.menu.update({
      where: { id },
      data: { fotoKey: key },
    });
    if (menu.fotoKey) await this.fotos.delete(menu.fotoKey); // troca: apaga a foto antiga
    return atualizado;
  }

  // A foto do menu como o servidor a tem (os mesmos bytes que o OCR lê): o app desenha os retângulos
  // em cima dela, então as coordenadas em pixels batem. A URL é a mesma depois de trocar a foto;
  // o ETag faz o navegador revalidar (cache privado, por padrão do serveFile)
  async servirFoto(id: string, req: unknown, res: unknown) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: { fotoKey: true },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado');
    if (!menu.fotoKey) throw new NotFoundException('Menu sem foto');
    return serveFile(this.fotos, menu.fotoKey, { req, res, disposition: 'inline' });
  }

  // Síncrono por enquanto; no passo 8 vira job na fila
  async executarOcr(id: string) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: { fotoKey: true },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado');
    if (!menu.fotoKey) throw new ConflictException('Menu sem foto: envie a foto antes do OCR');

    try {
      const imagem = await this.fotos.getBuffer(menu.fotoKey);
      const texto = await this.ocr.reconhecer(imagem);
      return await this.prisma.menu.update({
        where: { id },
        data: { textoOcr: texto, status: 'RECEBIDO' }, // sai de ERRO se for uma nova tentativa
      });
    } catch (e) {
      await this.prisma.menu.update({ where: { id }, data: { status: 'ERRO' } });
      throw e; // vira HTTP 500
    }
  }

  // O cliente circulou os nomes: troca a lista de itens por um item PROCESSANDO por recorte e enfileira
  // o OCR de cada um. O nome, o prato do catálogo e o status PRONTO chegam depois, pelo worker
  async marcarPratos(id: string, grupos: GrupoPratoDto[]) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: { fotoKey: true },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado');
    if (!menu.fotoKey) throw new ConflictException('Menu sem foto: envie a foto antes de marcar os pratos');

    // O id é gerado aqui para já poder virar o jobId. O app manda sempre a lista completa
    const itens: Prisma.MenuItemCreateManyInput[] = grupos.map(({ prato: r, ingredientes }, ordem) => ({
      id: randomUUID(),
      menuId: id,
      ordem,
      status: 'PROCESSANDO',
      nomeOriginal: '',
      regiaoX: r.x,
      regiaoY: r.y,
      regiaoLargura: r.largura,
      regiaoAltura: r.altura,
      // Sem ingredientes circulados: fica null (o worker só lê o prato)
      regioesIngredientes: ingredientes?.length
        ? ingredientes.map(({ x, y, largura, altura }) => ({ x, y, largura, altura }))
        : Prisma.DbNull,
    }));

    // Transação: ou troca tudo ou não troca nada. Jobs de OCR da lista antiga acham o item
    // inexistente e saem sem fazer nada
    await this.prisma.$transaction([
      this.prisma.menuItem.deleteMany({ where: { menuId: id } }),
      this.prisma.menuItem.createMany({ data: itens }),
      this.prisma.menu.update({ where: { id }, data: { status: 'PROCESSANDO' } }),
    ]);

    await this.filaOcr.addBulk(
      itens.map((i) => ({
        name: 'ler',
        data: { itemId: i.id! },
        opts: { ...OPCOES_JOB_PRATO, jobId: `ocr-${i.id}` },
      })),
    );
    return { itens: itens.length };
  }

  // "Não é esse prato": o voto vale para a foto que o cliente viu (imagemId), então clique duplo ou
  // atrasado não rejeita a foto nova. Só a foto é invalidada; a descrição não muda
  async naoEEsse(menuId: string, itemId: string, imagemId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: itemId, menuId },
      select: { dishId: true, nomeOriginal: true, menu: { select: { idioma: true } } },
    });
    if (!item) throw new NotFoundException('Item não encontrado');
    if (!item.dishId) throw new ConflictException('Item ainda sem prato no catálogo');
    const { dishId } = item;

    const imagem = await this.prisma.dishImage.findFirst({
      where: { id: imagemId, dishId },
      select: { id: true },
    });
    if (!imagem) throw new NotFoundException('Imagem não encontrada neste prato');

    // updateMany com ativa:true é atômico: se a foto já foi rejeitada, count = 0 e nada se repete
    const votou = await this.prisma.dishImage.updateMany({
      where: { id: imagemId, ativa: true },
      data: { votosNegativos: { increment: 1 } },
    });
    if (votou.count === 0) return { trocada: false };

    const desativou = await this.prisma.dishImage.updateMany({
      where: { id: imagemId, ativa: true, votosNegativos: { gte: LIMITE_VOTOS_NEGATIVOS } },
      data: { ativa: false },
    });
    if (desativou.count === 0) return { trocada: false }; // ainda faltam votos

    // O app refaz o GET (prato sem a foto errada) e o worker procura outra, ignorando as rejeitadas
    await this.eventos.publicar({ tipo: 'imagem', dishId });
    await this.filaImagens.addBulk(
      jobsDePratos('imagem', [
        { dishId, nome: item.nomeOriginal, idioma: item.menu.idioma ?? 'und' },
      ]),
    );
    return { trocada: true };
  }

  async addItem(menuId: string, dto: CreateMenuItemDto) {
    try {
      return await this.prisma.menuItem.create({ data: { ...dto, menuId } });
    } catch (e) {
      // P2003 = chave estrangeira inválida: o menu não existe
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new NotFoundException('Menu não encontrado');
      }
      throw e;
    }
  }
}
