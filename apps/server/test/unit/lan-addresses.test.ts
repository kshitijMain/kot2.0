import { describe, expect, it } from 'vitest';
import { mdnsInstanceName, mdnsTxt } from '../../src/tls/mdns.service.js';
import { lanAddresses, lanServerUrls } from '../../src/tls/tls-store.js';

const v4 = (address: string) => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4' as const,
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: `${address}/24`,
});

/** A Windows restaurant PC with a VPN, Hyper-V, VirtualBox and Bluetooth besides its Wi-Fi. */
const WINDOWS_PC = {
  'vEthernet (Default Switch)': [v4('172.29.16.1')],
  'VirtualBox Host-Only Network': [v4('192.168.56.1')],
  'Bluetooth Network Connection': [v4('169.254.10.4')],
  Tailscale: [v4('100.101.102.103')],
  Ethernet: [v4('10.0.0.15')],
  'Wi-Fi': [v4('192.168.1.20')],
  'Loopback Pseudo-Interface 1': [{ ...v4('127.0.0.1'), internal: true }],
};

describe('[AUTH-007] the addresses phones are given for the restaurant PC (P9-27)', () => {
  it('leaves out VPN, virtual-machine, Bluetooth and link-local adapters', () => {
    expect(lanAddresses(WINDOWS_PC)).toEqual(['192.168.1.20', '10.0.0.15']);
  });

  it('puts the adapter the installer chose for staff phones first', () => {
    expect(lanAddresses(WINDOWS_PC, 'ethernet')).toEqual(['10.0.0.15', '192.168.1.20']);
  });

  it('offers only addresses the certificate covers, best first', () => {
    const urls = lanServerUrls(
      { dnsNames: ['localhost'], ipAddresses: ['127.0.0.1', '10.0.0.15', '192.168.1.20'] },
      {
        tls: true,
        port: 8080,
        hostnames: [],
        addresses: ['192.168.1.20', '172.29.16.9', '10.0.0.15'],
      },
    );
    expect(urls).toEqual(['https://192.168.1.20:8080', 'https://10.0.0.15:8080']);
  });
});

describe('[AUTH-007] the PC’s announcement on the Wi-Fi (P9-27)', () => {
  it('carries the CA fingerprint without colons, so phones keep only their PC', () => {
    expect(mdnsTxt('3a:7f:00', true)).toEqual({ v: '1', tls: '1', ca: '3A7F00' });
    expect(mdnsTxt(null, false)).toEqual({ v: '1', tls: '0' });
  });

  it('names the PC after the restaurant', () => {
    expect(mdnsInstanceName('Mannat')).toBe('Mannat PC');
    expect(mdnsInstanceName('  ')).toBe('Parossa restaurant PC');
    expect(mdnsInstanceName('Café <Delhi> #1')).toBe('Café Delhi 1 PC');
  });
});
