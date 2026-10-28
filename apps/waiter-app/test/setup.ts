/**
 * The safe-area library is native: in Jest the phone has no system bars, so its insets are 0 and
 * its provider just renders the app.
 */
jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: unknown }) => children,
    useSafeAreaInsets: () => insets,
  };
});
