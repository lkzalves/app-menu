import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMenuDto } from './dto/create-menu.dto.js';

@Injectable()
export class MenusService {
  // O Nest injeta a única instância do PrismaService
  constructor(private readonly prisma: PrismaService) {}

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
}
