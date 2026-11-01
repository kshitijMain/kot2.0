import { MDNS_PROTOCOL, MDNS_SERVICE_TYPE } from '@rp/contracts';
import type { LanDiscovery, LanService, WifiRoute } from '@rp/mobile-core';

/** The DNS-SD service type the restaurant PC announces (P9-27): `_parossa-pos._tcp`. */
export const MDNS_SERVICE = `_${MDNS_SERVICE_TYPE}._${MDNS_PROTOCOL}`;

/** The native half of discovery, `RpLanDiscoveryModule.kt` (Android `NsdManager`). */
export interface LanDiscoveryNative {
  /** The services of `serviceType` resolved within `timeoutMs`: `{ name, host, port, txt }`. */
  discover(serviceType: string, timeoutMs: number): Promise<unknown[]>;
}

async function discoveryModule(): Promise<LanDiscoveryNative> {
  const { requireNativeModule } = await import('expo');
  return requireNativeModule<LanDiscoveryNative>('RpLanDiscovery');
}

/** One answer as the module gives it, kept only when it has the expected shape. */
function serviceOf(value: unknown): LanService[] {
  if (typeof value !== 'object' || value === null) return [];
  const { name, host, port, txt } = value as Record<string, unknown>;
  if (typeof host !== 'string' || typeof port !== 'number') return [];
  const records: Record<string, string> = {};
  if (typeof txt === 'object' && txt !== null) {
    for (const [key, entry] of Object.entries(txt)) {
      if (typeof entry === 'string') records[key.toLowerCase()] = entry;
    }
  }
  return [{ name: typeof name === 'string' ? name : '', host, port, txt: records }];
}

/**
 * Finding the restaurant PC on the Wi-Fi (P9-27, AUTH-007): Android's `NsdManager` browses
 * `_parossa-pos._tcp` while a Wi-Fi multicast lock is held, resolves each PC that answers and
 * stops after the timeout (or soon after the first answer). `@rp/mobile-core` keeps only answers
 * whose `ca` record names the CA the phone trusts, and checks the certificate itself before use.
 */
export class AndroidLanDiscovery implements LanDiscovery {
  constructor(private readonly native: () => Promise<LanDiscoveryNative> = discoveryModule) {}

  async discover(timeoutMs: number): Promise<readonly LanService[]> {
    const answers = await (await this.native()).discover(MDNS_SERVICE, timeoutMs);
    return answers.flatMap(serviceOf);
  }
}

/** What the Wi-Fi route module says: the Wi-Fi has no internet; the app is bound to it. */
export interface WifiRouteState {
  readonly wifiWithoutInternet: boolean;
  readonly bound: boolean;
}

/** The native half, `RpWifiRouteModule.kt` and `WifiRoute.kt`. */
export interface WifiRouteNative {
  /** Starts watching the Wi-Fi (once); resolves the state. */
  start(): Promise<WifiRouteState>;
  /** Re-checks the route with the PC's candidate addresses; resolves the state. */
  route(serverUrls: string[]): Promise<WifiRouteState>;
  addListener(eventName: 'onChange', listener: (state: WifiRouteState) => void): { remove(): void };
}

const NO_ROUTE: WifiRouteState = { wifiWithoutInternet: false, bound: false };

function stateOf(value: unknown): WifiRouteState {
  if (typeof value !== 'object' || value === null) return NO_ROUTE;
  const { wifiWithoutInternet, bound } = value as Record<string, unknown>;
  return { wifiWithoutInternet: wifiWithoutInternet === true, bound: bound === true };
}

/**
 * The app's own traffic over a Wi-Fi without internet (P9-27, NFR-A01). When the Wi-Fi is not
 * validated for internet but the restaurant PC answers on it, the module binds the app's process
 * to the Wi-Fi (`requestNetwork` without INTERNET, then `bindProcessToNetwork`): the app talks to
 * the PC over Wi-Fi while the rest of the phone uses mobile data. It lets go when the Wi-Fi has
 * internet again or goes away. Load it once with `AndroidWifiRoute.load()`.
 */
export class AndroidWifiRoute implements WifiRoute {
  private state: WifiRouteState = NO_ROUTE;
  private readonly listeners = new Set<() => void>();

  private constructor(private readonly native: WifiRouteNative) {}

  static async load(native?: WifiRouteNative): Promise<AndroidWifiRoute> {
    let module = native;
    if (module === undefined) {
      const { requireNativeModule } = await import('expo');
      module = requireNativeModule<WifiRouteNative>('RpWifiRoute');
    }
    const route = new AndroidWifiRoute(module);
    module.addListener('onChange', (state) => {
      route.set(state);
    });
    route.set(await module.start());
    return route;
  }

  async routeTo(serverUrls: readonly string[]): Promise<void> {
    this.set(await this.native.route([...serverUrls]));
  }

  wifiWithoutInternet(): boolean {
    return this.state.wifiWithoutInternet;
  }

  /** Whether the app's traffic is bound to the Wi-Fi now. */
  get bound(): boolean {
    return this.state.bound;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(value: unknown): void {
    const next = stateOf(value);
    if (
      next.wifiWithoutInternet === this.state.wifiWithoutInternet &&
      next.bound === this.state.bound
    ) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
