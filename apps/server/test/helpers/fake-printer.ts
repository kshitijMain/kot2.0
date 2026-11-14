import { once } from 'node:events';
import { type AddressInfo, createServer, type Server } from 'node:net';

/** A network printer on localhost that can be switched off and on again at the same port. */
export class FakePrinter {
  readonly jobs: string[] = [];
  port = 0;
  private server: Server | undefined;

  async start(): Promise<void> {
    const server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('end', () => {
        this.jobs.push(Buffer.concat(chunks).toString('latin1'));
        socket.end();
      });
    });
    server.listen(this.port, '127.0.0.1');
    await once(server, 'listening');
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    server.close();
    await once(server, 'close');
  }
}
