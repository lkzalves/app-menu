import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDisk, StorageDisk } from '@nestjs/storage';
import { Job, Queue } from 'bullmq';
import { CatalogoService } from '../catalogo/catalogo.service.js';
import { EventosService } from '../eventos/eventos.service.js';
import {
  DadosJobOcr,
  DadosJobPrato,
  FILA_DESCRICOES,
  FILA_IMAGENS,
  FILA_OCR,
  jobsDePratos,
} from '../fila/fila.constants.js';
import { OcrProvider } from '../ocr/ocr.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { limparNomePrato } from './nome-prato.util.js';

// Um job = um recorte. concurrency 1: o Tesseract é pesado e o catálogo cria pratos em sequência
// (dois nomes parecidos lidos ao mesmo tempo poderiam gerar dois pratos)
@Processor(FILA_OCR, { concurrency: 1 })
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectDisk('fotos') private readonly fotos: StorageDisk,
    private readonly ocr: OcrProvider,
    private readonly catalogo: CatalogoService,
    @InjectQueue(FILA_IMAGENS)
    private readonly filaImagens: Queue<DadosJobPrato>,
    @InjectQueue(FILA_DESCRICOES)
    private readonly filaDescricoes: Queue<DadosJobPrato>,
    private readonly eventos: EventosService,
  ) {
    super();
  }

  async process(job: Job<DadosJobOcr>) {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: job.data.itemId },
      select: {
        status: true,
        regiaoX: true,
        regiaoY: true,
        regiaoLargura: true,
        regiaoAltura: true,
        menu: { select: { id: true, fotoKey: true, idioma: true } },
      },
    });
    // Item sumiu (o app reenviou a lista) ou já foi lido (retry de um job que quase terminou)
    if (!item || item.status !== 'PROCESSANDO') return;

    const { menu } = item;
    const {
      regiaoX: x,
      regiaoY: y,
      regiaoLargura: largura,
      regiaoAltura: altura,
    } = item;
    if (
      !menu.fotoKey ||
      x === null ||
      y === null ||
      largura === null ||
      altura === null
    ) {
      await this.descartar(job.data.itemId, menu.id);
      return;
    }

    const imagem = await this.fotos.getBuffer(menu.fotoKey);
    const [texto] = await this.ocr.reconhecerRegioes(imagem, [
      { x, y, largura, altura },
    ]);
    const nome = limparNomePrato(texto ?? '').slice(0, 200); // 200 = limite do DTO de item

    // Recorte que não virou texto some da lista
    if (!nome) {
      await this.descartar(job.data.itemId, menu.id);
      return;
    }

    // "und" = idioma indeterminado (menu sem idioma escolhido)
    const idioma = menu.idioma ?? 'und';
    const dishId = await this.catalogo.obterOuCriar(nome, idioma);
    // updateMany: se o item foi apagado nesse meio tempo, não faz nada (e não dispara a busca)
    const { count } = await this.prisma.menuItem.updateMany({
      where: { id: job.data.itemId, status: 'PROCESSANDO' },
      data: { nomeOriginal: nome, dishId, status: 'PRONTO' },
    });
    if (count === 0) return;

    // O prato já pode buscar foto e descrição; os jobs têm id por prato, então repetir não duplica
    const prato = { dishId, nome, idioma };
    await this.filaImagens.addBulk(jobsDePratos('imagem', [prato]));
    await this.filaDescricoes.addBulk(jobsDePratos('descricao', [prato]));
    await this.eventos.publicar({ tipo: 'item', menuId: menu.id }); // o nome já pode aparecer no app
    await this.concluirSeTerminou(menu.id);
  }

  // Esgotou as tentativas: tira o item da lista, senão ficaria PROCESSANDO para sempre
  @OnWorkerEvent('failed')
  async aoFalhar(job: Job<DadosJobOcr> | undefined, erro: Error) {
    if (!job) return;
    this.logger.warn(
      `OCR do item ${job.data.itemId} falhou (tentativa ${job.attemptsMade}): ${erro.message}`,
    );
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return; // o BullMQ ainda vai tentar de novo

    const item = await this.prisma.menuItem.findUnique({
      where: { id: job.data.itemId },
      select: { menuId: true },
    });
    if (item) await this.descartar(job.data.itemId, item.menuId);
  }

  private async descartar(itemId: string, menuId: string) {
    await this.prisma.menuItem.deleteMany({
      where: { id: itemId, status: 'PROCESSANDO' },
    });
    await this.eventos.publicar({ tipo: 'removido', menuId });
    await this.concluirSeTerminou(menuId);
  }

  // Quando não sobra recorte a ler, o menu sai de PROCESSANDO
  private async concluirSeTerminou(menuId: string) {
    const faltam = await this.prisma.menuItem.count({
      where: { menuId, status: 'PROCESSANDO' },
    });
    if (faltam > 0) return;
    const { count } = await this.prisma.menu.updateMany({
      where: { id: menuId, status: 'PROCESSANDO' },
      data: { status: 'CONCLUIDO' },
    });
    if (count > 0) await this.eventos.publicar({ tipo: 'menu', menuId });
  }
}
