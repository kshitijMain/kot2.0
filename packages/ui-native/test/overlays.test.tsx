import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ScreenInsetsProvider,
  Sheet,
  type ToastOptions,
  ToastProvider,
  useToast,
  useToastClearance,
} from '../src/index.js';

/** A phone with gesture navigation: 24 points of status bar, 48 of navigation bar. */
const PHONE_BARS = { top: 24, right: 0, bottom: 48, left: 0 };
import { renderUi } from './render.js';

describe('[NFR-U01] Sheet', () => {
  function Host({ dismissible }: { dismissible?: boolean }) {
    const [open, setOpen] = useState(true);
    return (
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Paneer Tikka"
        footer={<Text>Footer</Text>}
        {...(dismissible !== undefined && { dismissible })}
      >
        <Text>Options</Text>
      </Sheet>
    );
  }

  it('shows its title, content and footer and closes from the button', async () => {
    await renderUi(<Host />);
    expect(screen.getByRole('header', { name: 'Paneer Tikka' })).toBeOnTheScreen();
    expect(screen.getByText('Footer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('sheet-close'));
    expect(screen.queryByText('Options')).toBeNull();
  });

  it('closes from the scrim and the back button unless busy', async () => {
    await renderUi(<Host />);
    await fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(screen.queryByText('Options')).toBeNull();

    await renderUi(<Host dismissible={false} />);
    await fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(screen.getByTestId('sheet-close')).toBeDisabled();
    expect(screen.getByText('Options')).toBeOnTheScreen();
  });

  it('keeps its footer above the navigation bar', async () => {
    await renderUi(
      <ScreenInsetsProvider insets={PHONE_BARS}>
        <Host />
      </ScreenInsetsProvider>,
    );
    expect(screen.getByTestId('sheet-footer')).toHaveStyle({ paddingBottom: 16 + 48 });
  });
});

describe('[NFR-U01] Toast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function Trigger({ toast }: { toast: ToastOptions }) {
    const api = useToast();
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          api.show(toast);
        }}
      >
        <Text>Show</Text>
      </Pressable>
    );
  }

  it('shows above the navigation bar', async () => {
    await renderUi(
      <ScreenInsetsProvider insets={PHONE_BARS}>
        <ToastProvider>
          <Trigger toast={{ title: 'KOT sent' }} />
        </ToastProvider>
      </ScreenInsetsProvider>,
    );
    expect(screen.getByTestId('toast-region')).toHaveStyle({ bottom: 24 + 48 });
  });

  it('[P9-28] sits above a screen footer that reports its height, and back down when it goes', async () => {
    function Footer() {
      const onLayout = useToastClearance();
      return <View testID="footer" onLayout={onLayout} />;
    }
    function Screen() {
      const [footer, setFooter] = useState(true);
      return (
        <>
          {footer ? <Footer /> : null}
          <Pressable
            onPress={() => {
              setFooter(false);
            }}
          >
            <Text>Close</Text>
          </Pressable>
        </>
      );
    }
    await renderUi(
      <ToastProvider>
        <Screen />
      </ToastProvider>,
    );
    await fireEvent(screen.getByTestId('footer'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 96 } },
    });
    expect(screen.getByTestId('toast-region')).toHaveStyle({ bottom: 96 + 8 });
    await fireEvent.press(screen.getByText('Close'));
    expect(screen.getByTestId('toast-region')).toHaveStyle({ bottom: 24 });
  });

  it('hides a success toast after the duration', async () => {
    await renderUi(
      <ToastProvider duration={3000}>
        <Trigger toast={{ title: 'KOT sent', description: 'Table 4', tone: 'success' }} />
      </ToastProvider>,
    );
    await fireEvent.press(screen.getByText('Show'));
    expect(screen.getByText('KOT sent')).toBeOnTheScreen();
    expect(screen.getByText('Table 4')).toBeOnTheScreen();
    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('KOT sent')).toBeNull();
  });

  it('keeps errors until dismissed and runs actions', async () => {
    const retry = jest.fn();
    await renderUi(
      <ToastProvider max={2}>
        <Trigger
          toast={{ title: 'Not sent', tone: 'danger', action: { label: 'Retry', onAction: retry } }}
        />
      </ToastProvider>,
    );
    await fireEvent.press(screen.getByText('Show'));
    await act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('toast-1')).toHaveProp('accessibilityRole', 'alert');
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Not sent')).toBeNull();

    await fireEvent.press(screen.getByText('Show'));
    await fireEvent.press(screen.getByText('Show'));
    await fireEvent.press(screen.getByText('Show'));
    expect(screen.getAllByText('Not sent')).toHaveLength(2);
    for (const button of screen.getAllByRole('button', { name: 'Dismiss notification' })) {
      await fireEvent.press(button);
    }
    expect(screen.queryByText('Not sent')).toBeNull();
  });

  it('needs its provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderUi(<Trigger toast={{ title: 'x' }} />)).rejects.toThrow(/ToastProvider/);
  });
});
