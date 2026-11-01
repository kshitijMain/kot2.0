import { DeviceSession, MemoryStore } from '@rp/mobile-core';
import {
  FakeDiscovery,
  FakeKeys,
  FakeWifiRoute,
  lanService,
  SocketFactory,
} from '@rp/mobile-core/testing';
import { render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { Restaurant, translator } from './restaurant';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

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
