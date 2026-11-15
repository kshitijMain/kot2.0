import { DeviceSession, MemoryStore } from '@rp/mobile-core';
import {
  FakeDiscovery,
  FakeKeys,
  FakeTrust,
  FakeWifiRoute,
  LAN_CA,
  lanService,
  OTHER_CA,
  SocketFactory,
} from '@rp/mobile-core/testing';
import { render, screen, waitFor } from '@testing-library/react-native';
import { App } from '../src/App';
import { Restaurant, translator } from './restaurant';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

/** Every session a test makes is stopped after it, so no timer keeps Jest running. */
const started: { stop(): void }[] = [];
afterEach(() => {
  for (const session of started.splice(0)) session.stop();
});

function setup(discovery: FakeDiscovery, wifi?: FakeWifiRoute) {
  const restaurant = new Restaurant();
  restaurant.holder = null;
  const server = restaurant.server();
  const plainStore = new MemoryStore();
  const session = new DeviceSession({
    secureStore: new MemoryStore(),
    plainStore,
    keys: new FakeKeys(),
    fetch: server.fetch,
    connect: new SocketFactory().connect,
    followAlerts: true,
    discovery,
    discoveryTimeoutMs: 10,
    ...(wifi !== undefined && { wifi }),
  });
  started.push(session);
  return { session, server, plainStore };
}

describe('[AUTH-007] [NFR-A01] one waiter app for every restaurant (P9-27)', () => {
  it('finds the restaurant PC on the Wi-Fi with no address built in', async () => {
    // A development PC without TLS answering mDNS.
    const discovery = new FakeDiscovery().answer(lanService('pos.test', 3000, null));
    const { session, server, plainStore } = setup(discovery);
    await session.start();
    await render(<App session={session} translator={translator} />);
    expect(await screen.findByRole('button', { name: 'Ravi, Waiter' })).toBeOnTheScreen();
    expect(server.callsTo('POST', '/api/v1/devices/pairing-codes/phone')).toHaveLength(1);
    expect(await plainStore.getItem('rp.server.v1')).toBe('http://pos.test:3000');
  });

  it('says to keep Wi-Fi on and turn on mobile data when the Wi-Fi has no internet', async () => {
    const wifi = new FakeWifiRoute(true);
    const { session } = setup(new FakeDiscovery(), wifi);
    await session.start();
    await render(<App session={session} translator={translator} />);
    expect(await screen.findByTestId('connect-no-internet')).toHaveTextContent(
      translator('connect.wifiNoInternet'),
    );
    expect(await screen.findByTestId('connect-error')).toHaveTextContent(
      translator('connect.failed'),
    );
    expect(screen.getByTestId('connect-scan')).toBeOnTheScreen();
  });
});

describe('[AUTH-007] a PC whose certificate changed (round 3 of testing)', () => {
  it('asks a paired phone to scan the PC’s code, and only that connects it again', async () => {
    const LAN = 'https://192.168.1.4:8080';
    const restaurant = new Restaurant();
    restaurant.holder = null;
    const server = restaurant.server();
    const sockets = new SocketFactory();
    const trust = new FakeTrust().serve(LAN, LAN_CA);
    const session = new DeviceSession({
      secureStore: new MemoryStore(),
      plainStore: new MemoryStore(),
      keys: new FakeKeys(),
      fetch: server.fetch,
      connect: sockets.connect,
      trust,
      discovery: new FakeDiscovery(),
      discoveryTimeoutMs: 10,
      // The PC is looked for again soon after it stops answering.
      relocateAfterMs: 10,
    });
    await session.start();
    started.push(session);
    await render(
      <App
        session={session}
        translator={translator}
        restaurant={{ servers: [LAN], caSha256: LAN_CA.sha256 }}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Ravi, Waiter' })).toBeOnTheScreen();

    // The PC was set up again: same address, another certificate.
    trust.serve(LAN, OTHER_CA);
    sockets.last.fire('disconnect', 'transport close');
    expect(await screen.findByTestId('connect-error')).toHaveTextContent(
      'This PC’s security certificate has changed – scan the Connect QR on the PC again.',
    );
    // Scanning is the only way: no address to type, nothing to try again.
    expect(screen.queryByTestId('connect-retry')).toBeNull();
    expect(screen.queryByTestId('connect-address')).toBeNull();

    expect(screen.getByTestId('connect-scan')).toBeOnTheScreen();

    // What scanning the PC's Connect QR code does (the camera itself: mobile-shell's tests).
    await session.connectByItself({ scanned: { servers: [LAN], caSha256: OTHER_CA.sha256 } });
    await waitFor(() => {
      expect(session.getSnapshot().certificateChanged).toBe(false);
    });
    expect(trust.pinned).toEqual({ certificate: OTHER_CA.certificate, serverUrl: LAN });
    expect(await screen.findByRole('button', { name: 'Ravi, Waiter' })).toBeOnTheScreen();
    session.stop();
  });
});
