import type * as I18n from '@rp/i18n';
import { createTranslator } from '@rp/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Root } from '../src/Root';

const t = createTranslator();
const mockDeviceSession = jest.fn();

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../src/session', () => {
  const { createTranslator: create } = jest.requireActual<typeof I18n>('@rp/i18n');
  return {
    deviceSession: () => mockDeviceSession() as unknown,
    appUpdater: () => Promise.reject(new Error('No updates here')),
    apkUpdater: () => Promise.reject(new Error('No installer here')),
    notifier: undefined,
    translator: create(),
  };
});

describe('[NFR-U04] the waiter app when it cannot start (QA audit, category A)', () => {
  it('says so with Try again instead of a blank screen, and tries again', async () => {
    mockDeviceSession.mockRejectedValue(new Error('The Keystore is not available'));
    await render(<Root />);
    expect(
      await screen.findByRole('header', { name: t('mobile.startupFailed.title') }),
    ).toBeTruthy();
    expect(mockDeviceSession).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: t('states.retry') }));
    await waitFor(() => {
      expect(mockDeviceSession).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByRole('header', { name: t('mobile.startupFailed.title') }),
    ).toBeTruthy();
  });
});
