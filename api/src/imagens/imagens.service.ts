import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDisk, serveFile, StorageDisk } from '@nestjs/storage';
import { PrismaService } from '../prisma/prisma.service.js';
import { IMAGE_PROVIDERS, ImageProvider } from './image.provider.js';

const TAMANHO_MAXIMO = 5 * 1024 * 1024; // 5 MB
const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
// A chave tem um uuid e nunca muda de conteúdo, então o navegador pode guardar para sempre
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

@Injectable()
export class ImagensService {
  private readonly logger = new Logger(ImagensService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectDisk('fotos') private readonly fotos: StorageDisk,
    @Inject(IMAGE_PROVIDERS) private readonly providers: ImageProvider[],
  ) {}

  // Garante uma foto ativa para o prato. Devolve false se nenhuma fonte achou algo aproveitável
  async garantirImagem(dishId: string, nome: string, idioma: string): Promise<boolean> {
    const existente = await this.prisma.dishImage.findFirst({
      where: { dishId, ativa: true },
      select: { id: true },
    });
    if (existente) return true; // cache compartilhado: prato resolvido uma vez serve para todos

    // Em ordem: a primeira fonte que achar e entregar um arquivo válido ganha
    for (const provider of this.providers) {
      const achada = await provider.buscar(nome, idioma);
      if (!achada) continue;

      const arquivo = await this.baixar(achada.urlDownload);
      if (!arquivo) continue; // download ruim conta como "não achou": tenta a próxima fonte

      const key = `pratos/${dishId}/${randomUUID()}.${arquivo.extensao}`;
      await this.fotos.put(key, arquivo.bytes, {
        contentType: arquivo.tipo,
        cacheControl: CACHE_CONTROL,
      });
      try {
        await this.prisma.dishImage.create({
          data: {
            dishId,
            fonte: achada.fonte,
            urlOrigem: achada.urlDownload,
            paginaOrigem: achada.paginaOrigem,
            storageKey: key,
            credito: achada.credito,
            licenca: achada.licenca,
          },
        });
      } catch (e) {
        await this.fotos.delete(key); // não deixa arquivo órfão
        throw e;
      }
      return true;
    }
    return false;
  }

  // Serve o arquivo de uma imagem ativa (Content-Type, ETag, Range e cache vêm do serveFile)
  async servir(id: string, req: unknown, res: unknown) {
    const imagem = await this.prisma.dishImage.findFirst({
      where: { id, ativa: true },
      select: { storageKey: true },
    });
    if (!imagem) throw new NotFoundException('Imagem não encontrada');
    return serveFile(this.fotos, imagem.storageKey, { req, res, disposition: 'inline' });
  }

  // Baixa e valida: só https, resposta OK, tipo de imagem aceito e até 5 MB. Qualquer falha vira null
  private async baixar(url: string) {
    try {
      if (!url.startsWith('https://')) return null;
      const resposta = await fetch(url);
      if (!resposta.ok) return null;

      const tipo = resposta.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      const extensao = EXTENSOES[tipo];
      if (!extensao) return null;
      if (Number(resposta.headers.get('content-length')) > TAMANHO_MAXIMO) return null;

      const bytes = Buffer.from(await resposta.arrayBuffer());
      if (bytes.length === 0 || bytes.length > TAMANHO_MAXIMO) return null;
      return { bytes, tipo, extensao };
    } catch (e) {
      this.logger.warn(`Falha ao baixar imagem: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
