import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDisk, StorageDisk } from '@nestjs/storage';
import { Prisma } from '../generated/prisma/client.js';
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
      include: { itens: { orderBy: { ordem: 'asc' } } },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado'); // vira HTTP 404
    return menu;
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
      select: { fotoKey: true },
    });
    if (!menu) throw new NotFoundException('Menu não encontrado');
    if (!menu.fotoKey) throw new ConflictException('Menu sem foto: envie a foto antes de marcar os pratos');

    const imagem = await this.fotos.getBuffer(menu.fotoKey);
    const textos = await this.ocr.reconhecerRegioes(imagem, regioes);

    // Recorte que não virou texto é descartado; ordem segue a lista que o app mandou
    const itens = regioes
      .map((r, i) => ({ r, nome: limparNomePrato(textos[i] ?? '') }))
      .filter((p) => p.nome)
      .map(({ r, nome }, ordem) => ({
        menuId: id,
        ordem,
        nomeOriginal: nome.slice(0, 200), // mesmo limite do DTO de item
        regiaoX: r.x,
        regiaoY: r.y,
        regiaoLargura: r.largura,
        regiaoAltura: r.altura,
      }));

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
