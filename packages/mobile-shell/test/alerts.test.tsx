import type { AlertView, DeviceAlertsResponse } from '@rp/contracts';
import {
  alertRaisedFrame,
  alertView,
  type FakeServer,
  fakeLocalServer,
  HOLDER,
} from '@rp/mobile-core/testing';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { BackHandler, Text } from 'react-native';
import { AlertBell, LoginScreen, Screen } from '../src/index.js';
import { ADDRESS, newSession, renderShell } from './harness.js';

const ALERTS = '/api/v1/devices/current/alerts';
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const ready = alertView({ createdAt: minutesAgo(4) });
const bill = alertView({
  id: '0199a0e0-0000-7000-8000-0000000a1e02',
  type: 'BILL_REQUEST',
  tableLabel: '7',
  pagerText: 'T7 BILL',
  payload: { requestedFrom: 'TABLE_TABLET' },
  repeatCount: 2,
  escalatedAt: minutesAgo(1),
  createdAt: minutesAgo(2),
});

const held = (...alerts: AlertView[]): DeviceAlertsResponse => ({ holder: HOLDER, alerts });

/** A server listing `alerts` for the waiter; nothing on the phone acknowledges them. */
function serverWith(alerts: DeviceAlertsResponse) {
  return fakeLocalServer().on('GET', ALERTS, () => ({ status: 200, body: alerts }));
}

async function phoneShowing(
  server: FakeServer,
  ui: Parameters<typeof renderShell>[1],
  { signIn = true, followAlerts = true } = {},
) {
  const { session, sockets } = newSession(server, undefined, { followAlerts });
  await session.start();
  await session.pair(ADDRESS, 'ABCD-EFGH');
  if (signIn) await session.signIn(HOLDER.staffId, '1234');
  await renderShell(session, ui);
  await act(async () => {
    sockets.sync();
    await Promise.resolve();
  });
  return { session, sockets };
}

function tables(onOpenTable?: (sessionId: string) => void) {
  return (
    <Screen
      title="Tables"
      actions={<AlertBell {...(onOpenTable !== undefined && { onOpenTable })} />}
    >
      <Text>My tables</Text>
    </Screen>
  );
}

describe('[WTR-006] [NFR-U03] the alert bell on the waiter app', () => {
  it('counts the open alerts and lists them newest first, with nothing to acknowledge', async () => {
    const server = serverWith(held(ready, bill));
    await phoneShowing(server, tables());
    const bell = await screen.findByRole('button', { name: 'Alerts, 2 open' });
    expect(bell).toHaveTextContent(/2/);
    expect(screen.getByText('My tables')).toBeOnTheScreen();

    await fireEvent.press(bell);
    expect(screen.getByRole('header', { name: 'Alerts' })).toBeOnTheScreen();
    const [first, second, ...others] = screen.getAllByTestId(/^alert-[0-9a-f-]+$/);
    if (first === undefined || second === undefined) throw new Error('Two alerts are listed');
    expect(others).toHaveLength(0);
    expect(first).toHaveProp('testID', `alert-${bill.id}`);
    expect(
      within(first).getByText('2 min ago · Reminded 2 times · Managers were alerted too'),
    ).toBeOnTheScreen();
    expect(second).toHaveProp('testID', `alert-${ready.id}`);
    expect(within(second).getByText('Paneer Tikka')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Acknowledge/ })).toBeNull();
    expect(server.callsTo('POST', `${ALERTS}/${ready.id}/acknowledge`)).toHaveLength(0);
  });

  it('opens the table of an alert tapped in the list', async () => {
    const opened: string[] = [];
    await phoneShowing(
      serverWith(held(ready)),
      tables((sessionId) => opened.push(sessionId)),
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Alerts, 1 open' }));
    await fireEvent.press(screen.getByTestId(`alert-${ready.id}`));
    expect(opened).toEqual([ready.tableSessionId]);
    expect(screen.queryByRole('header', { name: 'Alerts' })).toBeNull();
  });

  it('says when nothing is open', async () => {
    await phoneShowing(serverWith(held()), tables());
    await fireEvent.press(await screen.findByRole('button', { name: 'Alerts, none open' }));
    expect(screen.getByTestId('alerts-none')).toHaveTextContent(
      'No open alerts. New ones ring here and on the pager.',
    );
  });

  it('counts a new alert as it rings, and one cleared goes', async () => {
    let listed = held(ready);
    const server = fakeLocalServer().on('GET', ALERTS, () => ({ status: 200, body: listed }));
    const { sockets } = await phoneShowing(server, tables());
    await screen.findByRole('button', { name: 'Alerts, 1 open' });
    listed = held(ready, bill);
    await act(async () => {
      sockets.last.fire('event', alertRaisedFrame(1, bill));
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'Alerts, 2 open' })).toBeOnTheScreen();
  });

  it('shows nothing on a device that follows no alerts (the table tablet)', async () => {
    const server = serverWith(held(ready));
    await phoneShowing(server, tables(), { followAlerts: false });
    expect(screen.getByText('My tables')).toBeOnTheScreen();
    expect(screen.queryByTestId('alert-bell')).toBeNull();
    expect(server.callsTo('GET', ALERTS)).toHaveLength(0);
  });
});

describe('[AUTH-001] the sign-in screen of a waiter’s own phone', () => {
  it('opens on the PIN pad of the waiter the phone alerts, with the list behind "Not you?"', async () => {
    await phoneShowing(serverWith(held()), <LoginScreen roles={['WAITER']} />, {
      signIn: false,
    });
    expect(await screen.findByRole('header', { name: 'Enter the PIN for Ravi' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('login-not-you'));
    expect(await screen.findByTestId(`staff-${HOLDER.staffId}`)).toBeOnTheScreen();
  });

  it('goes back from the PIN pad to the list with the phone’s back button', async () => {
    const back = jest.spyOn(BackHandler, 'addEventListener');
    await phoneShowing(serverWith(held()), <LoginScreen roles={['WAITER']} />, {
      signIn: false,
    });
    await screen.findByRole('header', { name: 'Enter the PIN for Ravi' });
    const handler = back.mock.calls.at(-1)?.[1];
    await act(async () => {
      expect(handler?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
      await Promise.resolve();
    });
    expect(await screen.findByTestId(`staff-${HOLDER.staffId}`)).toBeOnTheScreen();
    back.mockRestore();
  });

  it('shows the list on a phone nobody holds', async () => {
    await phoneShowing(
      serverWith({ holder: null, alerts: [] }),
      <LoginScreen roles={['WAITER']} />,
      { signIn: false },
    );
    expect(await screen.findByTestId(`staff-${HOLDER.staffId}`)).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Enter the PIN for Ravi' })).toBeNull();
  });
});
