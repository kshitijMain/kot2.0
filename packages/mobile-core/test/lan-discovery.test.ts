import { describe, expect, it } from 'vitest';
import {
  DeviceSession,
  discoveredUrls,
  MemoryStore,
  normalizeFingerprint,
  sameFingerprint,
  ServerMismatchError,
  ServerUnreachableError,
} from '../src/index.js';
import {
  FakeDiscovery,
  FakeKeys,
  FakeTrust,
  FakeWifiRoute,
  fakeLocalServer,
  LAN_CA,
  lanService,
  OTHER_CA,
  SocketFactory,
} from '../src/testing/index.js';

/** The restaurant PC as the router first numbered it, and after the router gave it a new address. */
const LAN = 'https://192.168.1.20:8443';
const MOVED = 'https://192.168.1.33:8443';
/** The address the PC's Connect QR code shows, and the one a pilot build was made with. */
const QR = 'https://10.0.0.5:8443';
const BUILT_IN = 'https://172.16.0.9:8443';
/** A stranger's box on the same Wi-Fi. */
const STRANGER = 'https://192.168.1.66:8443';

function setup(
  options: {
    trust?: FakeTrust;
    discovery?: FakeDiscovery;
    wifi?: FakeWifiRoute;
    plainStore?: MemoryStore;
  } = {},
) {
  const fake = fakeLocalServer();
  const sockets = new SocketFactory();
  const keys = new FakeKeys();
  const plainStore = options.plainStore ?? new MemoryStore();
  const trust = options.trust ?? new FakeTrust();
  const discovery = options.discovery ?? new FakeDiscovery();
  const errors: unknown[] = [];
  const session = new DeviceSession({
    secureStore: new MemoryStore(),
    plainStore,
    keys,
    trust,
    discovery,
    ...(options.wifi !== undefined && { wifi: options.wifi }),
    fetch: fake.fetch,
    connect: sockets.connect,
    relocateAfterMs: 5,
    discoveryTimeoutMs: 10,
    onError: (error) => errors.push(error),
  });
  return { session, fake, sockets, keys, plainStore, trust, discovery, errors };
}

describe('[AUTH-007] [NFR-A01] the PC’s mDNS answers (P9-27)', () => {
  it('keeps only answers that announce the CA the phone expects, in either notation', () => {
    const services = [
      lanService('192.168.1.66', 8443, OTHER_CA),
      lanService('192.168.1.20', 8443, LAN_CA),
      { ...lanService('192.168.1.21', 8443), txt: { v: '1', tls: '1' } },
      lanService('192.168.1.22', 3000, null),
    ];
    expect(discoveredUrls(services, LAN_CA.sha256)).toEqual([LAN]);
    expect(discoveredUrls(services, normalizeFingerprint(LAN_CA.sha256).toLowerCase())).toEqual([
      LAN,
    ]);
  });

  it('takes every answer, TLS or not, when no CA is known yet (trust on first use)', () => {
    expect(
      discoveredUrls(
        [
          lanService('192.168.1.20', 8443),
          lanService('192.168.1.20', 8443),
          lanService('192.168.1.22', 3000, null),
          lanService('fe80::1', 8443),
        ],
        undefined,
      ),
    ).toEqual([LAN, 'http://192.168.1.22:3000', 'https://[fe80::1]:8443']);
  });

  it('passes over answers of another protocol version or with no usable address', () => {
    const v2 = { ...lanService('192.168.1.20', 8443), txt: { v: '2', tls: '1' } };
    expect(
      discoveredUrls(
        [v2, lanService('192.168.1.20', 0), lanService('192.168.1.20', 70_000), lanService('', 1)],
        undefined,
      ),
    ).toEqual([]);
  });

  it('compares fingerprints without colons or case', () => {
    expect(sameFingerprint('3a:7f', '3A7F')).toBe(true);
    expect(sameFingerprint('3A:7F', '3A:7E')).toBe(false);
    expect(sameFingerprint('', '')).toBe(false);
  });
});

describe('[AUTH-007] [NFR-A01] finding the restaurant PC with no address built in (P9-27)', () => {
  it('asks mDNS when nothing is remembered, and connects to the PC with the QR code’s CA', async () => {
    const trust = new FakeTrust().serve(STRANGER, OTHER_CA).serve(LAN, LAN_CA);
    const discovery = new FakeDiscovery().answer(
      lanService('192.168.1.66', 8443, OTHER_CA),
      lanService('192.168.1.20', 8443, LAN_CA),
    );
    const { session, plainStore, fake } = setup({ trust, discovery });
    await session.start();
    await session.connectByItself({ scanned: { servers: [QR], caSha256: LAN_CA.sha256 } });
    expect(session.getSnapshot()).toMatchObject({ phase: 'paired', serverUrl: LAN });
    // The stranger announcing another CA is not even asked for its certificate.
    expect(trust.fetched).toEqual([LAN]);
    expect(trust.pinned).toEqual({ certificate: LAN_CA.certificate, serverUrl: LAN });
    expect(await plainStore.getItem('rp.server.v1')).toBe(LAN);
    expect(await plainStore.getItem('rp.server-ca.v1')).toBe(LAN_CA.sha256);
    expect(fake.callsTo('POST', '/api/v1/devices/pair')).toHaveLength(1);
  });

  it('tries the remembered address first, then mDNS, then the QR code, then the build', async () => {
    const plainStore = new MemoryStore();
    await plainStore.setItem('rp.server.v1', LAN);
    // Only the address the app was built with still answers.
    const trust = new FakeTrust().serve(BUILT_IN, LAN_CA);
    const discovery = new FakeDiscovery().answer(lanService('192.168.1.33', 8443, LAN_CA));
    const { session } = setup({ trust, discovery, plainStore });
    await session.start();
    await session.connectByItself({
      scanned: { servers: [QR], caSha256: LAN_CA.sha256 },
      builtIn: { servers: [BUILT_IN], caSha256: LAN_CA.sha256 },
    });
    expect(trust.fetched).toEqual([LAN, MOVED, QR, BUILT_IN]);
    expect(session.getSnapshot().serverUrl).toBe(BUILT_IN);
  });

  it('stops at the first place the PC answers', async () => {
    const plainStore = new MemoryStore();
    await plainStore.setItem('rp.server.v1', LAN);
    const trust = new FakeTrust().serve(LAN, LAN_CA).serve(QR, LAN_CA);
    const discovery = new FakeDiscovery().answer(lanService('192.168.1.33', 8443, LAN_CA));
    const { session } = setup({ trust, discovery, plainStore });
    await session.start();
    await session.connectByItself({ scanned: { servers: [QR], caSha256: LAN_CA.sha256 } });
    expect(trust.fetched).toEqual([LAN]);
    expect(session.getSnapshot().serverUrl).toBe(LAN);
  });

  it('uses the QR code’s addresses when mDNS finds nothing, before those of the build', async () => {
    const trust = new FakeTrust().serve(QR, LAN_CA).serve(BUILT_IN, LAN_CA);
    const discovery = new FakeDiscovery();
    discovery.failure = new Error('No Wi-Fi');
    const { session, errors } = setup({ trust, discovery });
    await session.start();
    await session.connectByItself({
      scanned: { servers: [QR], caSha256: LAN_CA.sha256 },
      builtIn: { servers: [BUILT_IN] },
    });
    expect(trust.fetched).toEqual([QR]);
    expect(session.getSnapshot().serverUrl).toBe(QR);
    expect(errors).toContain(discovery.failure);
  });

  it('trusts the first PC that answers mDNS when no CA is known anywhere', async () => {
    const trust = new FakeTrust().serve(LAN, LAN_CA);
    const discovery = new FakeDiscovery().answer(lanService('192.168.1.20', 8443, LAN_CA));
    const { session } = setup({ trust, discovery });
    await session.start();
    await session.connectByItself();
    expect(session.getSnapshot()).toMatchObject({ phase: 'paired', serverUrl: LAN });
  });

  it('refuses a box that announces the PC’s CA but presents another certificate', async () => {
    const trust = new FakeTrust().serve(STRANGER, OTHER_CA);
    const discovery = new FakeDiscovery().answer(lanService('192.168.1.66', 8443, LAN_CA));
    const { session, fake } = setup({ trust, discovery });
    await session.start();
    await expect(
      session.connectByItself({ scanned: { servers: [], caSha256: LAN_CA.sha256 } }),
    ).rejects.toBeInstanceOf(ServerMismatchError);
    expect(fake.callsTo('POST', '/api/v1/devices/pairing-codes/phone')).toHaveLength(0);
    expect(session.getSnapshot().phase).toBe('unpaired');
  });

  it('says the PC did not answer when there is nowhere left to look', async () => {
    const { session } = setup();
    await session.start();
    await expect(session.connectByItself()).rejects.toBeInstanceOf(ServerUnreachableError);
    await expect(
      session.connectByItself({ builtIn: { servers: ['ftp://nowhere'] } }),
    ).rejects.toThrow('Enter the server address');
  });
});

describe('[AUTH-007] [NFR-A01] following the PC to a new address (P9-27)', () => {
  async function connected() {
    const trust = new FakeTrust().serve(LAN, LAN_CA);
    const discovery = new FakeDiscovery().answer(lanService('192.168.1.20', 8443, LAN_CA));
    const context = setup({ trust, discovery });
    await context.session.start();
    await context.session.connectByItself();
    context.sockets.sync(4);
    expect(context.session.getSnapshot().connection).toBe('online');
    return context;
  }

  it('switches to the same PC at its new address when it stops answering', async () => {
    const { session, sockets, trust, discovery, plainStore, keys, fake } = await connected();
    trust.move(LAN, MOVED);
    discovery.answer(lanService('192.168.1.33', 8443, LAN_CA));
    sockets.last.fire('disconnect', 'transport close');
    await expect.poll(() => session.getSnapshot().serverUrl).toBe(MOVED);
    expect(trust.pinned).toEqual({ certificate: LAN_CA.certificate, serverUrl: MOVED });
    expect(await plainStore.getItem('rp.server.v1')).toBe(MOVED);
    expect(sockets.last.url).toBe(`${MOVED}/rt`);
    // Still the same device: no new key and no pairing again.
    expect(keys.created).toBe(1);
    expect(fake.callsTo('POST', '/api/v1/devices/pair')).toHaveLength(1);
    expect(session.getSnapshot().phase).toBe('paired');
  });

  it('does not follow a PC with another CA, and keeps looking', async () => {
    const { session, sockets, trust, discovery } = await connected();
    trust.move(LAN, MOVED).serve(STRANGER, OTHER_CA);
    // A stranger announces the PC's CA but has another; another announces its own.
    discovery.answer(
      lanService('192.168.1.66', 8443, LAN_CA),
      lanService('192.168.1.33', 8443, OTHER_CA),
    );
    sockets.last.fire('disconnect', 'transport close');
    await expect.poll(() => discovery.calls).toBeGreaterThanOrEqual(3);
    expect(session.getSnapshot().serverUrl).toBe(LAN);
    expect(trust.pinned?.serverUrl).toBe(LAN);
    expect(trust.fetched).not.toContain(MOVED);
    session.stop();
  });

  it('leaves a PC that answers alone', async () => {
    const { session, discovery } = await connected();
    const before = discovery.calls;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(discovery.calls).toBe(before);
    expect(session.getSnapshot().serverUrl).toBe(LAN);
  });

  it('recognises the PC of a phone paired before its CA was remembered, by the pin', async () => {
    const { session, sockets, trust, discovery, plainStore } = await connected();
    await plainStore.removeItem('rp.server-ca.v1');
    trust.move(LAN, MOVED);
    discovery.answer(lanService('192.168.1.33', 8443, LAN_CA));
    sockets.last.fire('disconnect', 'transport close');
    await expect.poll(() => session.getSnapshot().serverUrl).toBe(MOVED);
  });
});

describe('[NFR-A01] a Wi-Fi without internet (P9-27)', () => {
  it('says so, and routes over the Wi-Fi to the addresses about to be tried', async () => {
    const wifi = new FakeWifiRoute(true);
    const trust = new FakeTrust().serve(LAN, LAN_CA);
    const discovery = new FakeDiscovery().answer(lanService('192.168.1.20', 8443, LAN_CA));
    const { session } = setup({ trust, discovery, wifi });
    expect(session.getSnapshot().wifiWithoutInternet).toBe(true);
    await session.start();
    await session.connectByItself();
    expect(wifi.routed).toEqual([[], [LAN]]);
    wifi.set(false);
    expect(session.getSnapshot().wifiWithoutInternet).toBe(false);
  });
});
