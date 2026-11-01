import { elevation, fontSize, fontWeight, radius, spacing, touchTarget } from '@rp/design-tokens';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { onBackPress } from '../back.js';
import { useScreenInsets } from '../insets.js';
import { useUiStrings } from '../strings.js';
import { useTheme, weight } from '../theme.js';
import { Glyph } from './Glyph.js';
import { Text } from './Text.js';

export interface SheetProps {
  open: boolean;
  /** Called by the close button, the Android back button and a tap on the scrim. */
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Actions pinned under the scrolling content, e.g. the quantity and "Add ₹240.00". */
  footer?: ReactNode;
  /** When false, the scrim and back button do nothing (e.g. while a submission is in flight). */
  dismissible?: boolean;
}

/**
 * A bottom sheet over the current screen: the waiter app's item options, table actions and
 * confirmations. The native counterpart of `@rp/ui-web` Dialog, with the same close words.
 */
export function Sheet({ open, onClose, title, children, footer, dismissible = true }: SheetProps) {
  const { colors } = useTheme();
  const strings = useUiStrings().dialog;
  // Drawn under the system bars (edge to edge): the last part keeps above the navigation bar.
  const { bottom } = useScreenInsets();
  const keyboard = useKeyboardHeight(open);
  const close = () => {
    if (dismissible) onClose();
  };
  // In a browser (P9-28), back (an iPhone's swipe) closes the sheet, not the screen under it.
  // Android's back reaches the Modal's onRequestClose instead.
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  });
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return undefined;
    return onBackPress(() => {
      latestClose.current();
      return true;
    });
  }, [open]);
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View style={[styles.backdrop, { paddingBottom: keyboard }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.close}
          importantForAccessibility="no"
          testID="sheet-scrim"
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surfaceRaised }]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.close}
              accessibilityState={{ disabled: !dismissible }}
              disabled={!dismissible}
              onPress={onClose}
              testID="sheet-close"
              style={styles.close}
            >
              <Glyph name="close" color={colors.textMuted} size={fontSize.xl} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.body,
              footer === undefined && { paddingBottom: spacing[4] + bottom },
            ]}
          >
            {children}
          </ScrollView>
          {footer === undefined ? null : (
            <View
              testID="sheet-footer"
              style={[
                styles.footer,
                { borderTopColor: colors.border, paddingBottom: spacing[4] + bottom },
              ]}
            >
              {footer}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * How tall the on-screen keyboard is while it is up (P9-21). The apps draw edge to edge, and
 * Android 15 and later then no longer shrink the window for the keyboard: a note or an amount
 * typed near the foot of a sheet or a screen was hidden under the keys. They rise by this much.
 */
export function useKeyboardHeight(active = true): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    if (Platform.OS === 'web') return watchBrowserKeyboard(setHeight);
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setHeight(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
      setHeight(0);
    };
  }, [active]);
  return height;
}

interface VisualViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener(type: 'resize' | 'scroll', listener: () => void): void;
  removeEventListener(type: 'resize' | 'scroll', listener: () => void): void;
}

/**
 * The keyboard's height in a browser (P9-28), which sends no keyboard events: what it hides of the
 * window, from the visual viewport. On an iPhone the keyboard covers the page without resizing it,
 * so a sheet's fields and buttons would sit under it.
 */
function watchBrowserKeyboard(setHeight: (height: number) => void): () => void {
  const browser = globalThis as { visualViewport?: VisualViewportLike; innerHeight?: number };
  const viewport = browser.visualViewport;
  if (viewport === undefined) return () => undefined;
  const update = () => {
    const hidden = (browser.innerHeight ?? viewport.height) - viewport.height - viewport.offsetTop;
    // Under 80 px is the browser's own bars moving, not a keyboard.
    setHeight(hidden > 80 ? Math.round(hidden) : 0);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    setHeight(0);
  };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    elevation: elevation[3].androidElevation,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    marginTop: spacing[2],
    borderRadius: radius.full,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing[5],
    paddingRight: spacing[1],
  },
  title: { flex: 1, fontSize: fontSize.xl, fontWeight: weight(fontWeight.bold) },
  close: {
    width: touchTarget.min,
    height: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: spacing[5], paddingVertical: spacing[4], gap: spacing[5] },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
  },
});
