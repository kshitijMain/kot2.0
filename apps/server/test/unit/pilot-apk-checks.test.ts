import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  addressProblem,
  builtInSettings,
  certificateCovers,
} from '../../../../scripts/pilot/apk-checks.mjs';

/**
 * The checks `build-waiter-apk.sh` and `parosaa-local.sh doctor` make (round 3 of testing): the
 * waiter app could not connect because the address and certificate it was built for did not
 * match what a phone on the Wi-Fi reaches.
 */

/** A minimal zip with one deflated file, as an APK stores `assets/app.config`. */
function zipWith(name: string, text: string): Buffer {
  const data = deflateRawSync(Buffer.from(text));
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(text.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(text.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralStart = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

describe('[AUTH-007] the waiter app is built for an address phones reach (round 3)', () => {
  it('refuses WSL’s own addresses and this computer’s, saying why', () => {
    expect(addressProblem('172.30.206.98')).toMatch(/WSL’s own address/);
    expect(addressProblem('https://172.17.0.1:8080')).toMatch(/WSL’s own address/);
    expect(addressProblem('127.0.0.1')).toMatch(/this computer itself/);
    expect(addressProblem('localhost')).toMatch(/this computer itself/);
    expect(addressProblem('169.254.10.4')).toMatch(/no address from the Wi-Fi/);
    expect(addressProblem('192.168.1.2')).toBeNull();
    expect(addressProblem('https://192.168.1.2:8080')).toBeNull();
    expect(addressProblem('10.0.0.5')).toBeNull();
    expect(addressProblem('pos.local')).toBeNull();
  });

  it('reads the address and certificate built into an APK', () => {
    const config = JSON.stringify({
      name: 'Parosaa Waiter',
      extra: {
        restaurantServers: ['https://192.168.1.2:8080'],
        restaurantCa: '5D:FD:00:C2',
      },
    });
    expect(builtInSettings(zipWith('assets/app.config', config))).toEqual({
      servers: ['https://192.168.1.2:8080'],
      ca: '5D:FD:00:C2',
    });
    // An APK built to find the PC by itself names none.
    expect(
      builtInSettings(zipWith('assets/app.config', '{"extra":{"restaurantServers":[]}}')),
    ).toEqual({ servers: [], ca: null });
    expect(() => builtInSettings(zipWith('assets/other', '{}'))).toThrow(/not a waiter app/);
  });

  it('says whether the certificate covers an address as phones check it', () => {
    const names =
      'DNS:localhost, DNS:laptop.local, DNS:172.30.206.98, IP Address:127.0.0.1, IP Address:172.30.206.98';
    // An address must be an IP entry: Android ignores an address written as a DNS name.
    expect(certificateCovers(names, '192.168.1.2')).toBe(false);
    expect(certificateCovers(`${names}, IP Address:192.168.1.2`, '192.168.1.2')).toBe(true);
    expect(certificateCovers(names, 'laptop.local')).toBe(true);
  });
});
