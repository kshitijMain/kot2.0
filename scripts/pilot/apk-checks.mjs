#!/usr/bin/env node
// Checks for the pilot's waiter app (round 3 of testing): the app could not connect because the
// address and certificate it was built for were not what a phone on the Wi-Fi reaches. Used by
// build-waiter-apk.sh and `parosaa-local.sh doctor`, and tested in apps/server/test/unit.
//
//   node scripts/pilot/apk-checks.mjs address 192.168.1.2      # exit 1 and say why if unusable
//   node scripts/pilot/apk-checks.mjs apk <file.apk>           # the address and certificate built in
//   node scripts/pilot/apk-checks.mjs covers "<SAN text>" <address>   # exit 1 when not covered
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The host of `https://192.168.1.2:8080` or `192.168.1.2`. */
function hostOf(address) {
  const text = address.trim();
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

/** Why a phone could never reach `address`, in plain words; null when it may. */
export function addressProblem(address) {
  const host = hostOf(address);
  if (host === 'localhost') {
    return 'localhost is this computer itself: a phone cannot reach it. Use the Wi-Fi address, for example 192.168.1.2.';
  }
  const parts = IPV4.exec(host);
  if (parts === null) return null;
  const [a, b] = [Number(parts[1]), Number(parts[2])];
  if (a === 127) {
    return `${host} is this computer itself: a phone cannot reach it. Use the Wi-Fi address, for example 192.168.1.2.`;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return `${host} is WSL’s own address inside this computer: a phone cannot reach it. Use the Wi-Fi address (scripts/pilot/parosaa-local.sh wifi shows and remembers it).`;
  }
  if (a === 169 && b === 254) {
    return `${host} means the computer got no address from the Wi-Fi. Connect it to the Wi-Fi and try again.`;
  }
  return null;
}

/** The deflated or stored file `name` from a zip (an APK), or undefined. */
function unzipEntry(zip, name) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) return undefined;
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) return undefined;
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const offset = zip.readUInt32LE(at + 42);
    const entry = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (entry === name) {
      const localNameLength = zip.readUInt16LE(offset + 26);
      const localExtraLength = zip.readUInt16LE(offset + 28);
      const start = offset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

/** The restaurant PC's addresses and certificate fingerprint built into a waiter app APK. */
export function builtInSettings(apk) {
  const config = unzipEntry(apk, 'assets/app.config');
  if (config === undefined)
    throw new Error('This file is not a waiter app (no assets/app.config).');
  const extra = JSON.parse(config.toString('utf8')).extra ?? {};
  return {
    servers: Array.isArray(extra.restaurantServers) ? extra.restaurantServers : [],
    ca: typeof extra.restaurantCa === 'string' ? extra.restaurantCa : null,
  };
}

/**
 * Whether a certificate's names (`openssl x509 -ext subjectAltName`) cover `address` as a phone
 * checks it: an address only as an IP entry (Android ignores an address written as a DNS name).
 */
export function certificateCovers(names, address) {
  const host = hostOf(address);
  const entries = names.split(/,\s*|\n\s*/).map((entry) => entry.trim());
  return IPV4.test(host)
    ? entries.includes(`IP Address:${host}`)
    : entries.some((entry) => entry.toLowerCase() === `dns:${host}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'address') {
  const problem = addressProblem(args[0] ?? '');
  if (problem !== null) {
    console.error(problem);
    process.exit(1);
  }
} else if (command === 'apk') {
  console.log(JSON.stringify(builtInSettings(readFileSync(args[0] ?? ''))));
} else if (command === 'covers') {
  if (!certificateCovers(args[0] ?? '', args[1] ?? '')) process.exit(1);
}
