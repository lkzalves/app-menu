import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDisk, StorageDisk } from '@nestjs/storage';
import { CatalogoService } from '../catalogo/catalogo.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { DescricoesService } from '../descricoes/descricoes.service.js';
import { ImagensService } from '../imagens/imagens.service.js';
import { OcrProvider } from '../ocr/ocr.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMenuItemDto } from './dto/create-menu-item.dto.js';
import { CreateMenuDto } from './dto/create-menu.dto.js';
import { RegiaoDto } from './dto/marcar-pratos.dto.js';
import { limparNomePrato } from './nome-prato.util.js';

@Injectable()
export class MenusService {
  // O Nest injeta a única instância do PrismaService
  constructor(
    private readonly prisma: PrismaService,
    @InjectDisk('fotos') private readonly fotos: StorageDisk,
    private readonly ocr: OcrProvider,
    private readonly catalogo: CatalogoService,
    private readonly imagens: ImagensService,
    private readonly descricoes: DescricoesService,
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

  // Busca a foto de cada prato do menu. Em sequência e idempotente: se uma fonte der 429 no meio,
  // o que já foi gravado fica e uma nova chamada continua de onde parou
  async buscarImagens(id: string) {
    const { idioma, pratos } = await this.pratosDoMenu(id);
    for (const p of pratos) await this.imagens.garantirImagem(p.dishId, p.nome, idioma);
    return this.findOne(id);
  }

  // Mesma ideia para a descrição (Wikipedia). Também em sequência e idempotente
  async buscarDescricoes(id: string) {
    const { idioma, pratos } = await this.pratosDoMenu(id);
    for (const p of pratos) await this.descricoes.garantirDescricao(p.dishId, p.nome, idioma);
    return this.findOne(id);
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

  // O cliente circulou os nomes: lê só esses recortes e troca a lista de pratos do menu
  async marcarPratos(id: string, regioes: RegiaoDto[]) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: { fotoKey: true, idioma: true },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado');
    if (!menu.fotoKey) throw new ConflictException('Menu sem foto: envie a foto antes de marcar os pratos');

    const imagem = await this.fotos.getBuffer(menu.fotoKey);
    const textos = await this.ocr.reconhecerRegioes(imagem, regioes);

    // Recorte que não virou texto é descartado; ordem segue a lista que o app mandou
    const lidos = regioes
      .map((r, i) => ({ r, nome: limparNomePrato(textos[i] ?? '').slice(0, 200) })) // 200 = limite do DTO de item
      .filter((p) => p.nome);

    // "und" = idioma indeterminado (o seletor do cliente só chega no app). Em sequência, para dois
    // nomes parecidos do mesmo cardápio não criarem dois pratos ao mesmo tempo
    const idioma = menu.idioma ?? 'und';
    const itens: Prisma.MenuItemCreateManyInput[] = [];
    for (const [ordem, { r, nome }] of lidos.entries()) {
      itens.push({
        menuId: id,
        ordem,
        nomeOriginal: nome,
        dishId: await this.catalogo.obterOuCriar(nome, idioma), // acha o prato no catálogo ou cria
        regiaoX: r.x,
        regiaoY: r.y,
        regiaoLargura: r.largura,
        regiaoAltura: r.altura,
      });
    }

    // Transação: ou troca tudo ou não troca nada. O app manda sempre a lista completa
    await this.prisma.$transaction([
      this.prisma.menuItem.deleteMany({ where: { menuId: id } }),
      this.prisma.menuItem.createMany({ data: itens }),
    ]);
    return this.findOne(id);
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
