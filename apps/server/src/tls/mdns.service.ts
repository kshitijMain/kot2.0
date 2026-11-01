import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { MDNS_PROTOCOL, MDNS_SERVICE_TYPE } from '@rp/contracts';
import { Bonjour, type Service } from 'bonjour-service';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../database/prisma.service.js';
import { TlsService } from './tls.service.js';

/** The TXT records phones read (P9-27): the CA fingerprint lets them keep only this PC's answer. */
export function mdnsTxt(caSha256: string | null, tls: boolean): Record<string, string> {
  return {
    v: '1',
    tls: tls ? '1' : '0',
    ...(caSha256 !== null && { ca: caSha256.replaceAll(':', '').toUpperCase() }),
  };
}

/** A DNS-SD instance name from the restaurant's name: printable, at most 63 bytes. */
export function mdnsInstanceName(restaurantName: string | undefined): string {
  const clean = (restaurantName ?? '')
    .replace(/[^\p{L}\p{N} &'().-]/gu, '')
    .trim()
    .slice(0, 50);
  return clean === '' ? 'Parossa restaurant PC' : `${clean} PC`;
}

/**
 * Announces the restaurant PC on the staff Wi-Fi (P9-27) as `_parossa-pos._tcp`, so the waiter app
 * finds it with no address built in and follows it when the router gives the PC a new one. The
 * answer carries the CA fingerprint, so a phone only connects to the PC it already trusts. Off in
 * tests and with `RP_MDNS=off`; a failure here never stops the server.
 */
@Injectable()
export class MdnsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MdnsService.name);
  private bonjour: Bonjour | undefined;
  private service: Service | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tls: TlsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Whether the PC is announcing itself now. */
  get announced(): boolean {
    return this.service !== undefined;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.mdns === 'off' || this.config.nodeEnv === 'test') return;
    try {
      // The CA is loaded before its fingerprint is announced.
      await this.tls.listenerOptions();
      const restaurant = await this.prisma.restaurant.findFirst({ select: { displayName: true } });
      this.bonjour = new Bonjour(undefined, (error: unknown) => {
        this.logger.warn({ err: error }, 'mDNS announcement failed');
      });
      this.service = this.bonjour.publish({
        name: mdnsInstanceName(restaurant?.displayName),
        type: MDNS_SERVICE_TYPE,
        protocol: MDNS_PROTOCOL,
        port: this.tls.listeningPort(),
        txt: mdnsTxt(this.tls.caFingerprint(), this.tls.enabled),
        disableIPv6: true,
      });
      this.logger.log(
        { type: `_${MDNS_SERVICE_TYPE}._${MDNS_PROTOCOL}`, port: this.tls.listeningPort() },
        'Announcing the restaurant PC on the local network',
      );
    } catch (error) {
      this.service = undefined;
      this.logger.warn({ err: error }, 'Could not announce the restaurant PC on the network');
    }
  }

  async onModuleDestroy(): Promise<void> {
    const bonjour = this.bonjour;
    if (bonjour === undefined) return;
    await new Promise<void>((resolve) => {
      bonjour.unpublishAll(() => {
        resolve();
      });
    });
    bonjour.destroy();
    this.bonjour = undefined;
    this.service = undefined;
  }
}
