import {
  elevation,
  fontSize,
  fontWeight,
  radius,
  spacing,
  touchTarget,
  type Tone,
  zIndex,
} from '@rp/design-tokens';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { GlyphName } from '../glyphs.js';
import { useScreenInsets } from '../insets.js';
import { useUiStrings } from '../strings.js';
import { toneColors, useTheme, weight } from '../theme.js';
import { Glyph } from './Glyph.js';
import { Text } from './Text.js';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: Tone;
  /**
   * Milliseconds before it hides itself; `null` keeps it until dismissed. Defaults to the
   * provider's duration, except `danger` toasts, which stay until dismissed.
   */
  duration?: number | null;
  action?: { label: string; onAction: () => void };
}

interface ToastRecord extends ToastOptions {
  readonly id: string;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (toast: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Says how tall a screen's footer is, so toasts sit above it (P9-28). */
const ClearanceContext = createContext<(height: number) => void>(() => undefined);

/**
 * A screen's footer button bar (Send KOT, Record payment) reports its height here, so toasts sit
 * above it instead of over it (P9-28: "Order sent" covered Send KOT). Returns the `onLayout` to put
 * on the footer; the clearance goes back to none when the footer goes.
 */
export function useToastClearance(): (event: {
  nativeEvent: { layout: { height: number } };
}) => void {
  const reserve = use(ClearanceContext);
  useEffect(
    () => () => {
      reserve(0);
    },
    [reserve],
  );
  return useCallback(
    (event) => {
      reserve(event.nativeEvent.layout.height);
    },
    [reserve],
  );
}

export const TONE_GLYPHS: Readonly<Record<Tone, GlyphName>> = {
  neutral: 'info',
  info: 'info',
  success: 'check',
  warning: 'warning',
  danger: 'error',
};

export interface ToastProviderProps {
  children: ReactNode;
  /** Auto-hide delay for non-error toasts, in milliseconds. */
  duration?: number;
  /** Oldest toasts are dropped beyond this many. */
  max?: number;
}

/**
 * Short, non-blocking messages at the bottom of the screen, with the same API as `@rp/ui-web`
 * Toast. Errors are announced assertively and stay until dismissed; others are polite.
 */
export function ToastProvider({ children, duration = 5000, max = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextId = useRef(0);
  // Above the navigation bar, and above a screen's footer button such as Send KOT's bar, whose
  // height the footer reports (`useToastClearance`); the footer already pads for the bar.
  const { bottom } = useScreenInsets();
  const [clearance, setClearance] = useState(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastOptions) => {
      nextId.current += 1;
      const id = `toast-${String(nextId.current)}`;
      setToasts((current) => [...current, { ...toast, id }].slice(-max));
      return id;
    },
    [max],
  );

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      <ClearanceContext value={setClearance}>{children}</ClearanceContext>
      <View
        pointerEvents="box-none"
        testID="toast-region"
        style={[
          styles.region,
          { bottom: clearance > 0 ? clearance + spacing[2] : spacing[6] + bottom },
        ]}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} defaultDuration={duration} onDismiss={dismiss} />
        ))}
      </View>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>.');
  return api;
}

function ToastItem({
  toast,
  defaultDuration,
  onDismiss,
}: {
  toast: ToastRecord;
  defaultDuration: number;
  onDismiss: (id: string) => void;
}) {
  const { colors } = useTheme();
  const strings = useUiStrings().toast;
  const tone = toast.tone ?? 'info';
  const palette = toneColors(colors, tone);
  const duration =
    toast.duration !== undefined ? toast.duration : tone === 'danger' ? null : defaultDuration;
  const { id } = toast;

  useEffect(() => {
    if (duration === null) return;
    const timer = setTimeout(() => {
      onDismiss(id);
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, id, onDismiss]);

  return (
    <View
      accessible={false}
      accessibilityRole={tone === 'danger' ? 'alert' : 'summary'}
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      testID={id}
      style={[styles.toast, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
    >
      <Glyph name={TONE_GLYPHS[tone]} color={palette.text} size={fontSize.lg} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>{toast.title}</Text>
        {toast.description === undefined ? null : (
          <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
            {toast.description}
          </Text>
        )}
      </View>
      {toast.action === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            toast.action?.onAction();
            onDismiss(id);
          }}
          style={styles.button}
        >
          <Text style={[styles.action, { color: colors.primary }]}>{toast.action.label}</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.dismiss}
        onPress={() => {
          onDismiss(id);
        }}
        style={styles.button}
      >
        <Glyph name="close" color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  region: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    bottom: spacing[6],
    gap: spacing[2],
    zIndex: zIndex.toast,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingLeft: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    elevation: elevation[3].androidElevation,
  },
  text: { flex: 1, paddingVertical: spacing[3], gap: spacing[1] },
  title: { fontSize: fontSize.md, fontWeight: weight(fontWeight.semibold) },
  action: { fontSize: fontSize.md, fontWeight: weight(fontWeight.semibold) },
  button: {
    minWidth: touchTarget.min,
    minHeight: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
  },
});
