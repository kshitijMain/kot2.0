import { fontSize, fontWeight, spacing } from '@rp/design-tokens';
import type { Translator } from '@rp/i18n';
import { Button, Text, ThemeProvider, useTheme } from '@rp/ui-native';
import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** The channel the phone web app's tabs on this phone talk on. */
const CHANNEL = 'rp-phone-tab';

interface ChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

/**
 * One tab per phone (P9-28): two tabs of the app would be the same device twice, each with its
 * live connection and its token refreshes, and get in each other's way. The tab opened last takes
 * over; the others stop and say so, with "Use it here" to take over again.
 */
export function OneTab({
  translator,
  onElsewhere,
  children,
}: {
  translator: Translator;
  onElsewhere: () => void;
  children: ReactNode;
}) {
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => {
    const Channel = (globalThis as { BroadcastChannel?: new (name: string) => ChannelLike })
      .BroadcastChannel;
    if (Channel === undefined) return undefined;
    const channel = new Channel(CHANNEL);
    channel.onmessage = (event) => {
      if ((event.data as { type?: unknown } | null)?.type !== 'opened') return;
      setElsewhere(true);
      onElsewhere();
    };
    channel.postMessage({ type: 'opened' });
    return () => {
      channel.close();
    };
  }, [onElsewhere]);
  if (!elsewhere) return children;
  return (
    <ThemeProvider>
      <Elsewhere t={translator} />
    </ThemeProvider>
  );
}

function Elsewhere({ t }: { t: Translator }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="open-elsewhere">
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {t('mobile.web.elsewhereTitle')}
      </Text>
      <Text style={{ color: colors.textMuted }}>{t('mobile.web.elsewhere')}</Text>
      <Button
        fullWidth
        testID="use-here"
        onPress={() => {
          // Loading again opens the app here, which tells the other tab to stop.
          globalThis.location.reload();
        }}
      >
        {t('mobile.web.useHere')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing[6], gap: spacing[4] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
});
