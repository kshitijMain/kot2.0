/**
 * How a phone finds the restaurant PC on the Wi-Fi with no address built into the app (P9-27,
 * AUTH-007, NFR-A01): the PC announces the DNS-SD service `_parossa-pos._tcp` over mDNS with TXT
 * records `v=1`, `tls=1|0` and `ca=<its CA's SHA-256, hex without colons>`. The Android module
 * (`NsdManager`) is the real one; tests pass a fake.
 */
export interface LanService {
  /** The service's instance name: the restaurant's name. */
  readonly name: string;
  /** The PC's address on the Wi-Fi (IPv4). */
  readonly host: string;
  readonly port: number;
  /** The TXT records. */
  readonly txt: Readonly<Record<string, string>>;
}

export interface LanDiscovery {
  /** The PCs that answered within `timeoutMs`; none when there is no Wi-Fi or nothing answers. */
  discover(timeoutMs: number): Promise<readonly LanService[]>;
}

/**
 * Whether the app's own traffic goes over a Wi-Fi without internet (P9-27): the Android module
 * binds the app to such a Wi-Fi when the restaurant PC answers there, so it talks to the PC over
 * Wi-Fi while the rest of the phone uses mobile data.
 */
export interface WifiRoute {
  /**
   * Re-checks the route with the PC's candidate addresses: on a Wi-Fi without internet the app is
   * bound to it when one of them answers there (or when none is known yet, so it can look).
   */
  routeTo(serverUrls: readonly string[]): Promise<void>;
  /** The phone is on a Wi-Fi that has no internet. */
  wifiWithoutInternet(): boolean;
  /** Called whenever `wifiWithoutInternet` may have changed. */
  subscribe(listener: () => void): () => void;
}

/** How long discovery listens for the PC's answer. */
export const DISCOVERY_TIMEOUT_MS = 4_000;

/** A CA fingerprint as compared: upper-case hex without colons (`AB:CD` and `abcd` are equal). */
export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

/** Whether two fingerprints, in either notation, name the same certificate. */
export function sameFingerprint(a: string, b: string): boolean {
  const left = normalizeFingerprint(a);
  return left !== '' && left === normalizeFingerprint(b);
}

/**
 * The addresses of the PCs that answered, keeping only those whose `ca` is `expectedCa` when one
 * is known (a stranger announcing the same service is passed over). Without an expected CA every
 * answer is a candidate: the first PC to answer is trusted on first use, as with a typed address.
 * A PC over TLS that announces no `ca` is kept only then.
 */
export function discoveredUrls(
  services: readonly LanService[],
  expectedCa: string | undefined,
): string[] {
  const urls: string[] = [];
  for (const service of services) {
    if (service.txt.v !== undefined && service.txt.v !== '1') continue;
    if (!Number.isInteger(service.port) || service.port <= 0 || service.port > 65_535) continue;
    const tls = service.txt.tls !== '0';
    if (expectedCa !== undefined) {
      // A PC without TLS has no certificate to match.
      if (!tls) continue;
      const announced = service.txt.ca;
      if (announced === undefined || !sameFingerprint(announced, expectedCa)) continue;
    }
    const host = service.host.includes(':') ? `[${service.host}]` : service.host;
    if (host === '') continue;
    urls.push(`${tls ? 'https' : 'http'}://${host}:${String(service.port)}`);
  }
  return [...new Set(urls)];
}
