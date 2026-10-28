import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ScreenBoundary, StartupFailed } from '../src/index.js';
import { newSession, renderShell, translator } from './harness.js';

const t = translator;
const broken = { on: true };

function Fragile() {
  if (broken.on) throw new Error('A screen bug');
  return <Text>Working</Text>;
}

describe('[NFR-U04] a screen that crashes (QA audit, category A)', () => {
  it('shows a plain message with Try again instead of a blank app', async () => {
    broken.on = true;
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session } = newSession();
    await renderShell(
      session,
      <ScreenBoundary>
        <Fragile />
      </ScreenBoundary>,
    );
    expect(screen.getByText(t('states.crashTitle'))).toBeTruthy();
    expect(screen.getByTestId('screen-crashed')).toHaveTextContent(t('states.crashDescription'));
    broken.on = false;
    await fireEvent.press(screen.getByRole('button', { name: t('states.retry') }));
    expect(screen.getByText('Working')).toBeTruthy();
    quiet.mockRestore();
  });

  it('says so when the app could not start, and tries again', async () => {
    const onRetry = jest.fn();
    await render(<StartupFailed translator={translator} onRetry={onRetry} />);
    expect(screen.getByRole('header', { name: t('mobile.startupFailed.title') })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t('states.retry') }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
