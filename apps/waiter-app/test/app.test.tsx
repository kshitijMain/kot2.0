import { CLIENT_API_VERSION } from '@rp/contracts';
import {
  type ApkInstaller,
  ApkUpdater,
  DeviceSession,
  type DownloadedApk,
  MemoryStore,
  OtaUpdater,
} from '@rp/mobile-core';
import {
  alertRaisedFrame,
  alertView,
  FakeKeys,
  itemReadyFrame,
  SocketFactory,
  STAFF,
} from '@rp/mobile-core/testing';
import type { AlertTableOpener } from '@rp/mobile-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { App } from '../src/App';
import { Restaurant, signedInApp, T2_SESSION, translator } from './restaurant';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

/** Android's PackageInstaller as the APK updater sees it (P7-04e2). */
class FakeInstaller implements ApkInstaller {
  readonly enabled = true;
  readonly installedVersion = '0.1.0';
  readonly calls: string[] = [];
  constructor(private readonly owner: boolean) {}
  silent(): boolean {
    return this.owner;
  }
  mayRequestInstall(): Promise<boolean> {
    return Promise.resolve(true);
  }
  openInstallSettings(): Promise<void> {
    return Promise.resolve();
  }
  download(): Promise<DownloadedApk> {
    this.calls.push('download');
    return Promise.resolve({ path: '/cache/rp-apk/new.apk' });
  }
  install(): Promise<void> {
    this.calls.push('install');
    return Promise.resolve();
  }
  onResult(): () => void {
    return () => undefined;
  }
}

/** The PC's newer build of the app, and the client API its server speaks. */
const appBuildRoutes = (kind: 'waiter-app' | 'table-tablet') =>
  [
    [
      '/api/v1/devices/current/app-build',
      {
        status: 200,
        body: {
          build: {
            kind,
            version: '9.0.0',
            clientApi: CLIENT_API_VERSION,
            sha256: 'd'.repeat(64),
            sizeBytes: 40_000_000,
          },
        },
      },
    ],
    [
      '/api/v1/version',
      {
        status: 200,
        body: {
          name: 'rp-server',
          version: '2.3.0',
          apiVersion: 'v1',
          node: '24.12.0',
          clientApi: { current: CLIENT_API_VERSION, oldest: CLIENT_API_VERSION },
        },
      },
    ],
  ] as const;

function setup() {
  const restaurant = new Restaurant();
  const server = restaurant.server();
  const sockets = new SocketFactory();
  const session = new DeviceSession({
    secureStore: new MemoryStore(),
    plainStore: new MemoryStore(),
    keys: new FakeKeys(),
    fetch: server.fetch,
    connect: sockets.connect,
    followAlerts: true,
  });
  return { restaurant, server, session, sockets };
}

describe('[WTR-001] a new APK from the restaurant PC on a waiter phone (P7-04e2)', () => {
  it('is offered on the sign-in screen and installed when the person asks', async () => {
    const { server, session } = setup();
    for (const [path, answer] of appBuildRoutes('waiter-app')) server.on('GET', path, () => answer);
    await session.start();
    await session.pair('http://pos.test:3000', 'ABCD-EFGH');
    const installer = new FakeInstaller(false);
    const apkUpdater = new ApkUpdater({ session, installer });
    await apkUpdater.check();
    await render(<App session={session} translator={translator} apkUpdater={apkUpdater} />);
    expect(await screen.findByText('Tap your name')).toBeOnTheScreen();
    expect(screen.getByTestId('apk-offer-text')).toHaveTextContent(
      translator('mobile.apk.available', { version: '9.0.0', megabytes: 40 }),
    );
    // A phone never installs by itself.
    expect(installer.calls).toEqual([]);
    await fireEvent.press(screen.getByTestId('apk-install'));
    expect(installer.calls).toEqual(['download', 'install']);
  });
});

describe('[UPD-001] over-the-air updates on a waiter phone', () => {
  it('restart the app on a downloaded update only once nobody is signed in', async () => {
    const { session } = setup();
    await session.start();
    await session.pair('http://pos.test:3000', 'ABCD-EFGH');
    await session.signIn(STAFF.WAITER.staffId, '4444');
    const reload = jest.fn(() => Promise.resolve());
    // The vendor's rollback to the APK's JavaScript: nothing to ask the server first.
    const updater = new OtaUpdater({
      session,
      source: {
        enabled: true,
        emergencyLaunchReason: null,
        check: () => Promise.resolve({ kind: 'rollback' }),
        fetch: () => Promise.resolve({ kind: 'rollback' }),
        reload,
      },
    });
    Object.assign(AppState, { currentState: 'active' });
    await render(<App session={session} translator={translator} updater={updater} />);
    await act(() => updater.check());
    expect(updater.getSnapshot().status).toBe('ready');
    expect(reload).not.toHaveBeenCalled();

    await fireEvent.press(await screen.findByTestId('home-menu'));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Tap your name')).toBeOnTheScreen();
    expect(reload).toHaveBeenCalledTimes(1);
    Object.assign(AppState, { currentState: undefined });
  });
});

describe('[WTR-001] waiter app smoke flow', () => {
  it('connects by itself, signs a waiter in, shows live tables and signs out', async () => {
    const { restaurant, session, sockets, server } = setup();
    // A new phone alerts nobody yet.
    restaurant.holder = null;
    await session.start();
    // ADR-0025, 2026-11-01: nobody pairs the phone; it connects to the PC it was built for.
    await render(
      <App
        session={session}
        translator={translator}
        restaurant={{ servers: ['http://pos.test:3000'] }}
      />,
    );
    expect(screen.queryByText('Pairing code')).toBeNull();

    await fireEvent.press(await screen.findByRole('button', { name: 'Ravi, Waiter' }));
    for (const digit of '4444') {
      await fireEvent.press(screen.getByRole('button', { name: digit }));
    }

    expect(await screen.findByRole('button', { name: 'T1, Free' })).toBeOnTheScreen();

    // Another device opens T1: the kitchen event makes the screen read the tables again.
    jest.useFakeTimers();
    restaurant.table('T1').state = 'OCCUPIED';
    await act(async () => {
      sockets.sync(0);
      sockets.last.fire('event', itemReadyFrame(1));
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    jest.useRealTimers();
    expect(await screen.findByRole('button', { name: 'T1, Occupied' })).toBeOnTheScreen();

    // Who is signed in, and signing out, are in the Menu.
    await fireEvent.press(screen.getByTestId('home-menu'));
    expect(screen.getByText('Signed in as Ravi')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Tap your name')).toBeOnTheScreen();
    expect(server.callsTo('POST', '/api/v1/auth/logout')).toHaveLength(1);
    expect(server.callsTo('POST', '/api/v1/devices/pairing-codes/phone')).toHaveLength(1);
  });

  it('says what to check when the PC does not answer, and connects to an address typed', async () => {
    const { restaurant, session, server } = setup();
    restaurant.holder = null;
    let refused = true;
    server.on('POST', '/api/v1/devices/pairing-codes/phone', () =>
      refused
        ? {
            status: 403,
            body: {
              code: 'SELF_PAIR_CLOSED',
              message: 'The restaurant PC does not let phones connect by themselves.',
            },
          }
        : {
            status: 201,
            body: {
              code: 'ABCD-EFGH',
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              caSha256: null,
              serverUrls: [],
              qrPayload: '{}',
            },
          },
    );
    await session.start();
    await render(
      <App
        session={session}
        translator={translator}
        restaurant={{ servers: ['http://pos.test:3000'] }}
      />,
    );
    expect(await screen.findByTestId('connect-error')).toHaveTextContent(
      'The restaurant PC does not let phones connect by themselves.',
    );
    expect(screen.getByText(translator('connect.wifi'))).toBeOnTheScreen();
    refused = false;
    await fireEvent.changeText(
      screen.getByLabelText('Restaurant PC address'),
      'http://pos.test:3000',
    );
    await fireEvent.press(screen.getByTestId('connect-retry'));
    expect(await screen.findByRole('button', { name: 'Ravi, Waiter' })).toBeOnTheScreen();
  });

  it('[AUTH-010] offers only waiters and managers on the login screen (ADR-0024)', async () => {
    const { restaurant, session } = setup();
    restaurant.holder = null;
    await session.start();
    await session.pair('http://pos.test:3000', 'ABCD-EFGH');
    await render(<App session={session} translator={translator} />);
    expect(await screen.findByRole('button', { name: 'Ravi, Waiter' })).toBeOnTheScreen();
    // ADR-0024: a manager's phone rings for diners' orders, so managers sign in here too.
    expect(screen.getByText('Meera')).toBeOnTheScreen();
    expect(screen.queryByText('Imran')).toBeNull();
    expect(screen.queryByText('Asha')).toBeNull();
  });

  it('[AUTH-001] opens on the PIN pad of the waiter the phone alerts', async () => {
    const { session, sockets } = setup();
    await session.start();
    await session.pair('http://pos.test:3000', 'ABCD-EFGH');
    await render(<App session={session} translator={translator} />);
    await act(async () => {
      sockets.sync();
      await Promise.resolve();
    });
    expect(await screen.findByRole('header', { name: 'Enter the PIN for Ravi' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Not you?' }));
    expect(await screen.findByRole('button', { name: 'Ravi, Waiter' })).toBeOnTheScreen();
  });

  it('says when there are no tables, and offers a retry when they cannot be read', async () => {
    const restaurant = new Restaurant();
    const server = restaurant.server();
    let calls = 0;
    server.on('GET', '/api/v1/tables/overview', () => {
      calls += 1;
      return calls === 1
        ? { status: 500, body: { code: 'INTERNAL', message: 'The server had a problem.' } }
        : { status: 200, body: { tables: [] } };
    });
    await signedInApp(restaurant, server);
    expect(await screen.findByText('The server had a problem.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(translator('mobile.tables.empty'))).toBeOnTheScreen();
  });
});

describe('[WTR-006] the waiter’s alerts on the phone', () => {
  const ready = alertView({
    createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    tableLabel: 'T2',
    tableSessionId: T2_SESSION,
    pagerText: 'T2 READY',
    payload: { items: ['Paneer Tikka'] },
  });

  it('counts them on the bell as they ring, with nothing to acknowledge', async () => {
    const restaurant = new Restaurant();
    const { sockets, server } = await signedInApp(restaurant);
    await act(async () => {
      sockets.sync();
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: /^T2, Occupied/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Alerts, none open' })).toBeOnTheScreen();

    restaurant.alerts.push(ready);
    await act(async () => {
      sockets.last.fire('event', alertRaisedFrame(1, ready));
      await Promise.resolve();
    });
    // Android shows the notification; the app only counts it, nothing covers the tables.
    await fireEvent.press(await screen.findByRole('button', { name: 'Alerts, 1 open' }));
    expect(screen.getByText('Table T2 · Food ready')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Acknowledge Table T2 · Food ready' })).toBeNull();

    // A tap on it opens the table.
    await fireEvent.press(screen.getByTestId(`alert-${ready.id}`));
    expect(await screen.findByRole('header', { name: 'Table T2' })).toBeOnTheScreen();
    expect(
      server.callsTo('POST', `/api/v1/devices/current/alerts/${ready.id}/acknowledge`),
    ).toHaveLength(0);
  });

  it('[AUTH-005] opens on the waiter’s PIN pad after an inactivity sign-out', async () => {
    const restaurant = new Restaurant();
    restaurant.alerts.push(ready);
    const { session, server, sockets } = await signedInApp(restaurant);
    expect(await screen.findByRole('button', { name: /^T2, Occupied/ })).toBeOnTheScreen();

    // The server signs Ravi out for inactivity; the phone still alerts him, like his pager.
    server.on('GET', '/api/v1/auth/session', () => ({
      status: 401,
      body: { code: 'SESSION_EXPIRED', message: 'Signed out after inactivity.' },
    }));
    await act(async () => {
      await session.keepAlive();
    });
    await act(async () => {
      sockets.sync();
      await Promise.resolve();
    });
    expect(await screen.findByRole('header', { name: 'Enter the PIN for Ravi' })).toBeOnTheScreen();
  });
});

/** Android's taps on alert notifications, as `AndroidAlertNotifier` passes them on. */
class FakeOpener implements AlertTableOpener {
  private listener: ((sessionId: string) => void) | undefined;
  constructor(private started: string | null = null) {}
  onOpenTable(listener: (sessionId: string) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
  takeOpenedTable(): Promise<string | null> {
    const started = this.started;
    this.started = null;
    return Promise.resolve(started);
  }
  tap(sessionId: string): void {
    this.listener?.(sessionId);
  }
}

describe('[WTR-005] a tapped alert notification', () => {
  it('opens its table while the app runs', async () => {
    const opener = new FakeOpener();
    await signedInApp(undefined, undefined, { opener });
    expect(await screen.findByRole('button', { name: /^T2, Occupied/ })).toBeOnTheScreen();
    await act(async () => {
      opener.tap(T2_SESSION);
      await Promise.resolve();
    });
    expect(await screen.findByRole('header', { name: 'Table T2' })).toBeOnTheScreen();
  });

  it('opens its table when the tap started the app', async () => {
    await signedInApp(undefined, undefined, { opener: new FakeOpener(T2_SESSION) });
    expect(await screen.findByRole('header', { name: 'Table T2' })).toBeOnTheScreen();
  });
});
