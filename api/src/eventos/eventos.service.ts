import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  concatMap,
  filter,
  interval,
  map,
  merge,
  Observable,
  startWith,
  Subject,
  takeUntil,
} from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

// Os eventos são só avisos: o app refaz GET /menus/:id para ver o que mudou
export interface Evento {
  tipo: 'item' | 'removido' | 'menu' | 'imagem' | 'descricao';
  menuId?: string; // item, removido, menu
  dishId?: string; // imagem, descricao (o prato pode estar em vários menus)
}

const PING_MS = 25_000; // mantém a conexão viva atrás de proxies

@Injectable()
export class EventosService
  implements OnModuleInit, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(EventosService.name);
  private readonly canal: string;
  private assinante!: Redis;
  private readonly eventos$ = new Subject<Evento>(); // tudo que chega do Redis neste processo
  private readonly encerrar$ = new Subject<void>();

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.canal = `${config.get<string>('REDIS_PREFIX') ?? 'bull'}:eventos`;
  }

  // Uma única assinatura por processo; cada cliente SSE só filtra o Subject
  async onModuleInit() {
    this.assinante = this.redis.duplicate(); // conexão em modo subscriber não serve para mais nada
    this.assinante.on('message', (_canal, texto) => {
      try {
        this.eventos$.next(JSON.parse(texto) as Evento);
      } catch {
        this.logger.warn(`Evento inválido ignorado: ${texto}`);
      }
    });
    await this.assinante.subscribe(this.canal);
  }

  // Quem publica é o worker (pode ser outro processo): vai pelo Redis. Falha aqui nunca derruba o job
  async publicar(evento: Evento) {
    try {
      await this.redis.publish(this.canal, JSON.stringify(evento));
    } catch (e) {
      this.logger.warn(
        `Falha ao publicar evento: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async garantirMenu(menuId: string) {
    const existe = await this.prisma.menu.count({ where: { id: menuId } });
    if (!existe) throw new NotFoundException('Menu não encontrado');
  }

  // Stream de um menu: "ready" ao abrir, depois os eventos do menu e dos pratos dele
  fluxo(menuId: string): Observable<MessageEvent> {
    const doMenu = this.eventos$.pipe(
      concatMap(async (e) => ((await this.pertence(e, menuId)) ? e : null)), // concatMap mantém a ordem
      filter((e): e is Evento => e !== null),
      map((e): MessageEvent => ({
        type: e.tipo,
        data: { menuId, dishId: e.dishId },
      })),
    );
    const ping = interval(PING_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );
    return merge(doMenu, ping).pipe(
      startWith({ type: 'ready', data: { menuId } } satisfies MessageEvent),
      takeUntil(this.encerrar$),
    );
  }

  // Evento de prato interessa se o prato está num item deste menu
  private async pertence(e: Evento, menuId: string) {
    if (e.menuId) return e.menuId === menuId;
    if (!e.dishId) return false;
    return (
      (await this.prisma.menuItem.count({
        where: { menuId, dishId: e.dishId },
      })) > 0
    );
  }

  // Com stream aberto o servidor HTTP não fecha: completa todos antes (precisa de enableShutdownHooks)
  beforeApplicationShutdown() {
    this.encerrar$.next();
  }

  async onApplicationShutdown() {
    await this.assinante?.quit();
  }
}
