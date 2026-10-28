import { createTranslator } from '@rp/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Root } from '../src/Root';

const t = createTranslator();
const mockInstallRandomValues = jest.fn();

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));
jest.mock('@rp/mobile-native', () => ({
  installRandomValues: () => mockInstallRandomValues() as unknown,
}));

describe('[NFR-U04] the table tablet when it cannot start (QA audit, category A)', () => {
  it('says so with Try again instead of a blank screen, and tries again', async () => {
    mockInstallRandomValues.mockRejectedValue(new Error('The native module is missing'));
    await render(<Root />);
    expect(
      await screen.findByRole('header', { name: t('mobile.startupFailed.title') }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t('states.retry') }));
    await waitFor(() => {
      expect(mockInstallRandomValues).toHaveBeenCalledTimes(2);
    });
  });
});
