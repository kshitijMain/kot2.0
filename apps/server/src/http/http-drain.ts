import type { Server } from 'node:http';
import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/** How long requests still being answered get to finish when the server stops. */
export const DRAIN_MS = 10_000;

/**
 * Stops taking requests when the server stops (an update, a restore, the Windows service), and
 * lets the ones being answered finish before the database closes (QA-041). Nest tears the modules
 * down before it closes the HTTP server, so a payment or a kitchen bump in flight lost its database
 * connection half way and the device got "Something went wrong".
 */
@Injectable()
export class HttpDrain implements BeforeApplicationShutdown {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  async beforeApplicationShutdown(): Promise<void> {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server | undefined;
    if (server?.listening !== true) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DRAIN_MS);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      // Kept-alive connections with no request in flight close now; busy ones after answering.
      server.closeIdleConnections();
    });
  }
}
