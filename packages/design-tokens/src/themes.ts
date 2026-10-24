/**
 * Semantic colour roles for every theme (NFR-U01, NFR-U02). Components use roles, never raw
 * colours, so a theme or the restaurant accent can change without touching components.
 *
 * The Parossa palette (ADR-0022): warm off-white pages, teal for actions and saffron for highlights.
 * Every theme meets WCAG 2.2 AA (checked by tests); both kitchen themes reach AAA for text (KDS-011).
 */

/**
 * `kds` is the kitchen display's light, high-contrast theme (the default, ADR-0022); `kds-dark` is
 * its near-black alternative, chosen with the `kds.theme` setting. Both use the large type and the
 * 64 px touch targets.
 */
export const THEME_NAMES = ['light', 'dark', 'kds', 'kds-dark'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
export type Tone = (typeof TONES)[number];

export interface ColorRoles {
  /** Page background. */
  readonly background: string;
  /** Cards, panels, table rows. */
  readonly surface: string;
  /** Dialogs, sheets, toasts, menus. */
  readonly surfaceRaised: string;
  /** Wells, inputs, keypad backgrounds. */
  readonly surfaceSunken: string;
  /** Decorative dividers (not relied on to identify controls). */
  readonly border: string;
  /** Control outlines (inputs, secondary buttons); at least 3:1 against surfaces. */
  readonly borderStrong: string;
  readonly text: string;
  readonly textMuted: string;
  /** Disabled text (exempt from contrast rules, always paired with another cue). */
  readonly textDisabled: string;
  readonly textInverse: string;
  readonly primary: string;
  readonly primaryHover: string;
  readonly primaryActive: string;
  readonly onPrimary: string;
  /** Restaurant accent slot; defaults to primary and is overridden per restaurant (NFR-U02). */
  readonly accent: string;
  readonly onAccent: string;
  /**
   * The brand's saffron highlight for staff screens: selected items, badges, small decorative
   * touches. Not the restaurant accent. The fill is not a text colour and is never the only cue;
   * `onHighlight` is text on the fill, `highlightText` is saffron text on surfaces and the subtle fill.
   */
  readonly highlight: string;
  readonly onHighlight: string;
  readonly highlightSubtle: string;
  readonly highlightText: string;
  readonly focusRing: string;
  /** Scrim behind dialogs and sheets. */
  readonly overlay: string;
  readonly neutral: string;
  readonly onNeutral: string;
  readonly neutralSubtle: string;
  readonly neutralText: string;
  readonly info: string;
  readonly onInfo: string;
  readonly infoSubtle: string;
  readonly infoText: string;
  readonly success: string;
  readonly onSuccess: string;
  readonly successSubtle: string;
  readonly successText: string;
  readonly warning: string;
  readonly onWarning: string;
  readonly warningSubtle: string;
  readonly warningText: string;
  readonly danger: string;
  readonly onDanger: string;
  readonly dangerSubtle: string;
  readonly dangerText: string;
}

const light: ColorRoles = {
  background: '#faf7f2',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#f3efe8',
  border: '#ebe5db',
  borderStrong: '#7c756c',
  text: '#1c1917',
  textMuted: '#57534e',
  textDisabled: '#a8a29e',
  textInverse: '#faf7f2',
  primary: '#0f766e',
  primaryHover: '#115e59',
  primaryActive: '#134e4a',
  onPrimary: '#ffffff',
  accent: '#0f766e',
  onAccent: '#ffffff',
  highlight: '#f7931e',
  onHighlight: '#1c1917',
  highlightSubtle: '#fff4e5',
  highlightText: '#a64b08',
  focusRing: '#0f766e',
  overlay: 'rgb(28 25 23 / 0.45)',
  neutral: '#57534e',
  onNeutral: '#ffffff',
  neutralSubtle: '#efebe4',
  neutralText: '#44403c',
  info: '#1d4ed8',
  onInfo: '#ffffff',
  infoSubtle: '#e8eefd',
  infoText: '#1e40af',
  success: '#15803d',
  onSuccess: '#ffffff',
  successSubtle: '#e3f5e9',
  successText: '#166534',
  warning: '#a16207',
  onWarning: '#ffffff',
  warningSubtle: '#fdf4d3',
  warningText: '#854d0e',
  danger: '#b91c1c',
  onDanger: '#ffffff',
  dangerSubtle: '#fdecec',
  dangerText: '#991b1b',
};

const dark: ColorRoles = {
  background: '#111716',
  surface: '#1a2120',
  surfaceRaised: '#222b2a',
  surfaceSunken: '#0b100f',
  border: '#2c3634',
  borderStrong: '#8a9a97',
  text: '#f2f5f4',
  textMuted: '#c3ccca',
  textDisabled: '#5f6b69',
  textInverse: '#111716',
  primary: '#2dd4bf',
  primaryHover: '#5eead4',
  primaryActive: '#99f6e4',
  onPrimary: '#042f2e',
  accent: '#2dd4bf',
  onAccent: '#042f2e',
  highlight: '#f7931e',
  onHighlight: '#1c1917',
  highlightSubtle: '#3d2410',
  highlightText: '#fdba74',
  focusRing: '#5eead4',
  overlay: 'rgb(5 8 8 / 0.7)',
  neutral: '#a8b5b2',
  onNeutral: '#0f172a',
  neutralSubtle: '#2c3634',
  neutralText: '#e2e8e6',
  info: '#7aa2f7',
  onInfo: '#0f172a',
  infoSubtle: '#1e2a5a',
  infoText: '#c7d7fe',
  success: '#4ade80',
  onSuccess: '#052e16',
  successSubtle: '#14532d',
  successText: '#bbf7d0',
  warning: '#facc15',
  onWarning: '#1c1917',
  warningSubtle: '#5c4a0b',
  warningText: '#fef08a',
  danger: '#f87171',
  onDanger: '#0f172a',
  dangerSubtle: '#7f1d1d',
  dangerText: '#fecaca',
};

/**
 * Kitchen display, light (the default, ADR-0022): near-black text on warm white, deep status
 * colours and AAA text, readable from 2 m under kitchen lights (KDS-011).
 */
const kds: ColorRoles = {
  background: '#f5f2ec',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#ede9e1',
  border: '#c9c2b6',
  borderStrong: '#57534e',
  text: '#0c0a09',
  textMuted: '#3a3632',
  textDisabled: '#8a847c',
  textInverse: '#ffffff',
  primary: '#0b5f58',
  primaryHover: '#0a4f49',
  primaryActive: '#083f3a',
  onPrimary: '#ffffff',
  accent: '#0b5f58',
  onAccent: '#ffffff',
  highlight: '#f7931e',
  onHighlight: '#000000',
  highlightSubtle: '#fde7c8',
  highlightText: '#7c2d12',
  focusRing: '#b45309',
  overlay: 'rgb(12 10 9 / 0.55)',
  neutral: '#57534e',
  onNeutral: '#ffffff',
  neutralSubtle: '#e7e2d9',
  neutralText: '#292524',
  info: '#1e40af',
  onInfo: '#ffffff',
  infoSubtle: '#dbe6fe',
  infoText: '#1e3a8a',
  success: '#166534',
  onSuccess: '#ffffff',
  successSubtle: '#dcfce7',
  successText: '#14532d',
  warning: '#854d0e',
  onWarning: '#ffffff',
  warningSubtle: '#fef9c3',
  warningText: '#713f12',
  danger: '#991b1b',
  onDanger: '#ffffff',
  dangerSubtle: '#fee2e2',
  dangerText: '#7f1d1d',
};

/** Kitchen display, dark (`kds.theme` = DARK): near-black background, saturated status colours, AAA text. */
const kdsDark: ColorRoles = {
  background: '#000000',
  surface: '#121212',
  surfaceRaised: '#1f1f1f',
  surfaceSunken: '#000000',
  border: '#333333',
  borderStrong: '#a3a3a3',
  text: '#ffffff',
  textMuted: '#d4d4d4',
  textDisabled: '#737373',
  textInverse: '#000000',
  primary: '#2dd4bf',
  primaryHover: '#5eead4',
  primaryActive: '#99f6e4',
  onPrimary: '#000000',
  accent: '#2dd4bf',
  onAccent: '#000000',
  highlight: '#f7931e',
  onHighlight: '#000000',
  highlightSubtle: '#4a2a0a',
  highlightText: '#fed7aa',
  focusRing: '#fde047',
  overlay: 'rgb(0 0 0 / 0.75)',
  neutral: '#a3a3a3',
  onNeutral: '#000000',
  neutralSubtle: '#333333',
  neutralText: '#f5f5f5',
  info: '#7aa2f7',
  onInfo: '#000000',
  infoSubtle: '#1e2a5a',
  infoText: '#e0e7ff',
  success: '#22c55e',
  onSuccess: '#000000',
  successSubtle: '#14532d',
  successText: '#dcfce7',
  warning: '#facc15',
  onWarning: '#000000',
  warningSubtle: '#713f12',
  warningText: '#fef9c3',
  danger: '#ef4444',
  onDanger: '#000000',
  dangerSubtle: '#7f1d1d',
  dangerText: '#fee2e2',
};

export const themes: Readonly<Record<ThemeName, ColorRoles>> = {
  light,
  dark,
  kds,
  'kds-dark': kdsDark,
};

/** Themes whose surfaces are dark; used for `color-scheme` (native form controls, scrollbars). */
export const DARK_THEMES: readonly ThemeName[] = ['dark', 'kds-dark'];

/** The kitchen display's themes: large type and 64 px touch targets (KDS-011). */
export const KDS_THEMES: readonly ThemeName[] = ['kds', 'kds-dark'];
