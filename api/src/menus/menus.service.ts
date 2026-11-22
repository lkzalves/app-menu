import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDisk, StorageDisk } from '@nestjs/storage';
import { Prisma } from '../generated/prisma/client.js';
import { Queue } from 'bullmq';
import {
  DadosJobOcr,
  DadosJobPrato,
  FILA_DESCRICOES,
  FILA_IMAGENS,
  FILA_OCR,
  jobsDePratos,
  OPCOES_JOB_PRATO,
} from '../fila/fila.constants.js';
import { OcrProvider } from '../ocr/ocr.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMenuItemDto } from './dto/create-menu-item.dto.js';
import { CreateMenuDto } from './dto/create-menu.dto.js';
import { RegiaoDto } from './dto/marcar-pratos.dto.js';

@Injectable()
export class MenusService {
  // O Nest injeta a única instância do PrismaService
  constructor(
    private readonly prisma: PrismaService,
    @InjectDisk('fotos') private readonly fotos: StorageDisk,
    private readonly ocr: OcrProvider,
    @InjectQueue(FILA_OCR) private readonly filaOcr: Queue<DadosJobOcr>,
    @InjectQueue(FILA_IMAGENS) private readonly filaImagens: Queue<DadosJobPrato>,
    @InjectQueue(FILA_DESCRICOES) private readonly filaDescricoes: Queue<DadosJobPrato>,
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
            dish: {
              select: {
                descricao: true,
                descricaoUrl: true, // crédito: "Fonte: Wikipédia" com este link
                imagens: {
                  where: { ativa: true },
                  orderBy: { criadoEm: 'asc' },
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
  async marcarPratos(id: string, regioes: RegiaoDto[]) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: { fotoKey: true },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado');
    if (!menu.fotoKey) throw new ConflictException('Menu sem foto: envie a foto antes de marcar os pratos');

    // O id é gerado aqui para já poder virar o jobId. O app manda sempre a lista completa
    const itens: Prisma.MenuItemCreateManyInput[] = regioes.map((r, ordem) => ({
      id: randomUUID(),
      menuId: id,
      ordem,
      status: 'PROCESSANDO',
      nomeOriginal: '',
      regiaoX: r.x,
      regiaoY: r.y,
      regiaoLargura: r.largura,
      regiaoAltura: r.altura,
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
