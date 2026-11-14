import { once } from 'node:events';
import { type AddressInfo, createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { NetworkAndUsbTransport } from '../../src/printing/printer-transport.js';

/** The probe the print queue uses to notice a printer is back (ADR-0031). */
describe('[KDS-008] asking a printer whether it is there, printing nothing', () => {
  it('says yes when a network printer takes a connection, and sends it nothing', async () => {
    const received: number[] = [];
    const printer = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk.length));
    });
    printer.listen(0, '127.0.0.1');
    await once(printer, 'listening');
    const { port } = printer.address() as AddressInfo;
    const transport = new NetworkAndUsbTransport(2_000);
    expect(await transport.probe({ connection: 'NETWORK', host: '127.0.0.1', port })).toBe(true);
    printer.close();
    await once(printer, 'close');
    expect(received).toEqual([]);
    // Nothing listens there now.
    expect(await transport.probe({ connection: 'NETWORK', host: '127.0.0.1', port })).toBe(false);
  });

  it('cannot tell for a USB printer, so the queue keeps its wait', async () => {
    const transport = new NetworkAndUsbTransport(2_000);
    expect(await transport.probe({ connection: 'USB', host: 'KitchenPrinter', port: null })).toBe(
      false,
    );
  });
});
