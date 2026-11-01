import {
  FakeDiscovery,
  FakeTrust,
  FakeWifiRoute,
  LAN_CA,
  lanService,
  OTHER_CA,
} from '@rp/mobile-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ConnectScreen, connectTargetOf } from '../src/index.js';
import { fakeServer, newSession, renderShell, translator } from './harness.js';

const LAN = 'https://192.168.1.20:8443';
const QR = 'https://10.0.0.5:8443';

const mockCamera = { permission: { granted: true, canAskAgain: true } };

// The camera: a view the test "shows" a QR code to by firing `barcodeScanned` at it.
jest.mock('expo-camera', () => {
  const { createElement } = jest.requireActual<{
    createElement: (type: unknown, props: object) => unknown;
  }>('react');
  const { View } = jest.requireActual<{ View: unknown }>('react-native');
  return {
    CameraView: (props: object) => createElement(View, props),
    useCameraPermissions: () => [mockCamera.permission, () => Promise.resolve(null)],
  };
});

function connectQr(payload: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, kind: 'connect', name: 'Mannat', ...payload });
}

async function setup(options: {
  trust: FakeTrust;
  discovery?: FakeDiscovery;
  wifi?: FakeWifiRoute;
  servers?: readonly string[];
}) {
  const server = fakeServer();
  const { session } = newSession(server, options.trust, {
    discovery: options.discovery ?? new FakeDiscovery(),
    ...(options.wifi !== undefined && { wifi: options.wifi }),
  });
  await session.start();
  await renderShell(
    session,
    <ConnectScreen {...(options.servers !== undefined && { servers: options.servers })} />,
  );
  return { server, session };
}

async function scan(data: string) {
  await fireEvent.press(await screen.findByTestId('connect-scan'));
  await fireEvent(await screen.findByTestId('pairing-camera'), 'barcodeScanned', { data });
}

describe('[AUTH-007] [NFR-A01] the connect screen finds the PC by itself (P9-27)', () => {
  it('connects to the PC that answers on the Wi-Fi, with no address built in', async () => {
    const trust = new FakeTrust().serve(LAN, LAN_CA);
    const discovery = new FakeDiscovery().answer(lanService('192.168.1.20', 8443));
    const { session } = await setup({ trust, discovery });
    await waitFor(() => {
      expect(session.getSnapshot().phase).toBe('paired');
    });
    expect(session.getSnapshot().serverUrl).toBe(LAN);
  });

  it('connects with the Connect QR code when nothing answers on the Wi-Fi', async () => {
    const trust = new FakeTrust().serve(QR, LAN_CA);
    const { session } = await setup({ trust });
    expect(await screen.findByTestId('connect-error')).toHaveTextContent(
      translator('connect.failed'),
    );
    await scan(connectQr({ urls: [QR], ca: LAN_CA.sha256 }));
    await waitFor(() => {
      expect(session.getSnapshot().phase).toBe('paired');
    });
    expect(session.getSnapshot().serverUrl).toBe(QR);
    expect(trust.pinned).toEqual({ certificate: LAN_CA.certificate, serverUrl: QR });
  });

  it('refuses a PC whose certificate is not the one in the Connect QR code', async () => {
    const trust = new FakeTrust().serve(QR, OTHER_CA);
    const { session, server } = await setup({ trust });
    await screen.findByTestId('connect-error');
    await scan(connectQr({ urls: [QR], ca: LAN_CA.sha256 }));
    await waitFor(() => {
      expect(screen.getByTestId('connect-error')).toHaveTextContent(translator('connect.mismatch'));
    });
    expect(session.getSnapshot().phase).toBe('unpaired');
    expect(server.callsTo('POST', '/api/v1/devices/pairing-codes/phone')).toHaveLength(0);
  });

  it('says so when the code scanned is not the PC’s', async () => {
    const { session } = await setup({ trust: new FakeTrust() });
    await screen.findByTestId('connect-error');
    await scan('https://example.com/menu');
    expect(await screen.findByTestId('connect-error')).toHaveTextContent(
      translator('connect.notConnectCode'),
    );
    expect(session.getSnapshot().phase).toBe('unpaired');
  });

  it('leaves the camera with Back', async () => {
    await setup({ trust: new FakeTrust() });
    await fireEvent.press(await screen.findByTestId('connect-scan'));
    await fireEvent.press(await screen.findByText(translator('connect.scanCancel')));
    expect(await screen.findByTestId('connect-retry')).toBeOnTheScreen();
  });

  it('tells the person to turn on mobile data on a Wi-Fi without internet', async () => {
    const wifi = new FakeWifiRoute(true);
    await setup({ trust: new FakeTrust(), wifi });
    expect(await screen.findByTestId('connect-no-internet')).toHaveTextContent(
      translator('connect.wifiNoInternet'),
    );
  });
});

describe('[AUTH-007] reading a scanned code (P9-27)', () => {
  it('reads the Connect QR code and a pairing QR code’s addresses', () => {
    expect(connectTargetOf(connectQr({ urls: [QR], ca: LAN_CA.sha256 }))).toEqual({
      servers: [QR],
      caSha256: LAN_CA.sha256,
    });
    expect(connectTargetOf(connectQr({ urls: [QR] }))).toEqual({ servers: [QR] });
    expect(
      connectTargetOf(JSON.stringify({ v: 1, code: 'ABCD-EFGH', urls: [LAN], ca: LAN_CA.sha256 })),
    ).toEqual({ servers: [LAN], caSha256: LAN_CA.sha256 });
    expect(connectTargetOf(JSON.stringify({ v: 1, code: 'ABCD-EFGH' }))).toBeUndefined();
    expect(connectTargetOf(connectQr({ urls: [] }))).toBeUndefined();
    expect(connectTargetOf('not json')).toBeUndefined();
  });
});
