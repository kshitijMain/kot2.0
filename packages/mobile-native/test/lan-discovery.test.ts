import { describe, expect, it } from 'vitest';
import {
  AndroidLanDiscovery,
  AndroidWifiRoute,
  type LanDiscoveryNative,
  MDNS_SERVICE,
  type WifiRouteNative,
  type WifiRouteState,
} from '../src/index.js';

describe('[AUTH-007] finding the restaurant PC by mDNS on Android (P9-27)', () => {
  it('browses the PC’s service and keeps the answers that have an address', async () => {
    const asked: [string, number][] = [];
    const native: LanDiscoveryNative = {
      discover: (serviceType, timeoutMs) => {
        asked.push([serviceType, timeoutMs]);
        return Promise.resolve([
          { name: 'Mannat', host: '192.168.1.20', port: 8443, txt: { V: '1', tls: '1', ca: 'AB' } },
          { name: 'Odd', host: 42, port: 8443 },
          { host: '192.168.1.21', port: 8443, txt: { v: 1 } },
          null,
        ]);
      },
    };
    const discovery = new AndroidLanDiscovery(() => Promise.resolve(native));
    expect(await discovery.discover(4_000)).toEqual([
      { name: 'Mannat', host: '192.168.1.20', port: 8443, txt: { v: '1', tls: '1', ca: 'AB' } },
      { name: '', host: '192.168.1.21', port: 8443, txt: {} },
    ]);
    expect(asked).toEqual([['_parossa-pos._tcp', 4_000]]);
    expect(MDNS_SERVICE).toBe('_parossa-pos._tcp');
  });
});

describe('[NFR-A01] the app over a Wi-Fi without internet on Android (P9-27)', () => {
  function fakeRoute() {
    let emit: ((state: WifiRouteState) => void) | undefined;
    const routed: string[][] = [];
    const native: WifiRouteNative = {
      start: () => Promise.resolve({ wifiWithoutInternet: true, bound: false }),
      route: (serverUrls) => {
        routed.push(serverUrls);
        return Promise.resolve({ wifiWithoutInternet: true, bound: true });
      },
      addListener: (_event, listener) => {
        emit = listener;
        return { remove: () => undefined };
      },
    };
    return { native, routed, emit: (state: WifiRouteState) => emit?.(state) };
  }

  it('says whether the Wi-Fi has internet and binds to it for the PC’s addresses', async () => {
    const { native, routed, emit } = fakeRoute();
    const route = await AndroidWifiRoute.load(native);
    expect(route.wifiWithoutInternet()).toBe(true);
    expect(route.bound).toBe(false);
    let changes = 0;
    const unsubscribe = route.subscribe(() => (changes += 1));

    await route.routeTo(['https://192.168.1.20:8443']);
    expect(routed).toEqual([['https://192.168.1.20:8443']]);
    expect(route.bound).toBe(true);
    expect(changes).toBe(1);

    // The same state again is no change; Wi-Fi with internet is.
    emit({ wifiWithoutInternet: true, bound: true });
    expect(changes).toBe(1);
    emit({ wifiWithoutInternet: false, bound: false });
    expect(route.wifiWithoutInternet()).toBe(false);
    expect(changes).toBe(2);
    unsubscribe();
    emit({ wifiWithoutInternet: true, bound: false });
    expect(changes).toBe(2);
  });
});
