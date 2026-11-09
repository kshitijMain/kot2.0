/**
 * Semantic colour roles for every theme (NFR-U01, NFR-U02). Components use roles, never raw
 * colours, so a theme or the restaurant accent can change without touching components.
 *
 * The Parosaa palette (ADR-0028): warm cream pages, saffron actions with deep ink text, gold for
 * accents, royal indigo for links and data, teal only for small success marks.
 * Every theme meets WCAG 2.2 AA (checked by tests); both kitchen themes reach AAA for text (KDS-011).
 */

/**
 * `kds` is the kitchen display's light, high-contrast theme (the default, ADR-0022); `kds-dark` is
 * its deep ink alternative, chosen with the `kds.theme` setting. Both use the large type and the
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
  /** Links and data highlights (charts, report numbers): royal indigo. */
  readonly link: string;
  /** Thin decorative dividers: gold. */
  readonly divider: string;
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
  background: '#fbf7f0',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#f4eee3',
  border: '#e7dfd1',
  borderStrong: '#908777',
  text: '#20223d',
  textMuted: '#5f5f74',
  textDisabled: '#a9a398',
  textInverse: '#fbf7f0',
  primary: '#e8821e',
  primaryHover: '#ee9237',
  primaryActive: '#d17217',
  onPrimary: '#20223d',
  accent: '#e8821e',
  onAccent: '#20223d',
  highlight: '#e8821e',
  onHighlight: '#20223d',
  highlightSubtle: '#fdefdc',
  highlightText: '#9a5410',
  link: '#1b2a6b',
  divider: '#f5a623',
  focusRing: '#1b2a6b',
  overlay: 'rgb(32 34 61 / 0.45)',
  neutral: '#6b6459',
  onNeutral: '#ffffff',
  neutralSubtle: '#f1ebe0',
  neutralText: '#4a4538',
  info: '#1b2a6b',
  onInfo: '#ffffff',
  infoSubtle: '#e6e9f5',
  infoText: '#1b2a6b',
  success: '#1aa26e',
  onSuccess: '#20223d',
  successSubtle: '#e4f6ee',
  successText: '#0f7550',
  warning: '#8a6100',
  onWarning: '#ffffff',
  warningSubtle: '#fbf1c7',
  warningText: '#6f4e00',
  danger: '#b3261e',
  onDanger: '#ffffff',
  dangerSubtle: '#fcebe9',
  dangerText: '#8c1d18',
};

const dark: ColorRoles = {
  background: '#20223d',
  surface: '#2a2d4c',
  surfaceRaised: '#33365a',
  surfaceSunken: '#191b31',
  border: '#3d4064',
  borderStrong: '#8a8ba3',
  text: '#fbf7f0',
  textMuted: '#b8b4aa',
  textDisabled: '#6e6f8a',
  textInverse: '#20223d',
  primary: '#f5a623',
  primaryHover: '#f7b64a',
  primaryActive: '#f9c570',
  onPrimary: '#20223d',
  accent: '#f5a623',
  onAccent: '#20223d',
  highlight: '#f5a623',
  onHighlight: '#20223d',
  highlightSubtle: '#473a22',
  highlightText: '#fad38a',
  link: '#a9b6f0',
  divider: '#f5a623',
  focusRing: '#f7c567',
  overlay: 'rgb(14 15 28 / 0.7)',
  neutral: '#a8a9bd',
  onNeutral: '#20223d',
  neutralSubtle: '#3d4064',
  neutralText: '#e4e2dc',
  info: '#a9b6f0',
  onInfo: '#20223d',
  infoSubtle: '#2b3468',
  infoText: '#d5dcf7',
  success: '#3ddc9c',
  onSuccess: '#20223d',
  successSubtle: '#17453a',
  successText: '#9ff0cd',
  warning: '#f0dc7a',
  onWarning: '#20223d',
  warningSubtle: '#4a4320',
  warningText: '#f7eba6',
  danger: '#f2867c',
  onDanger: '#20223d',
  dangerSubtle: '#5c2430',
  dangerText: '#fbcfca',
};

/**
 * Kitchen display, light (the default, ADR-0022): deep ink text on warm cream, deep status colours
 * and AAA text, readable from 2 m under kitchen lights (KDS-011).
 */
const kds: ColorRoles = {
  background: '#fbf7f0',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#f1eadd',
  border: '#d9cfbe',
  borderStrong: '#6b6556',
  text: '#20223d',
  textMuted: '#45465c',
  textDisabled: '#8f897c',
  textInverse: '#fbf7f0',
  primary: '#e8821e',
  primaryHover: '#ee9237',
  primaryActive: '#d17217',
  onPrimary: '#20223d',
  accent: '#e8821e',
  onAccent: '#20223d',
  highlight: '#e8821e',
  onHighlight: '#20223d',
  highlightSubtle: '#fde7c8',
  highlightText: '#7a4208',
  link: '#1b2a6b',
  divider: '#f5a623',
  focusRing: '#1b2a6b',
  overlay: 'rgb(32 34 61 / 0.55)',
  neutral: '#5a5546',
  onNeutral: '#ffffff',
  neutralSubtle: '#ebe4d6',
  neutralText: '#3a3628',
  info: '#1b2a6b',
  onInfo: '#ffffff',
  infoSubtle: '#dde2f4',
  infoText: '#1b2a6b',
  success: '#0f7550',
  onSuccess: '#ffffff',
  successSubtle: '#d9f3e6',
  successText: '#0b5c3f',
  warning: '#6f4e00',
  onWarning: '#ffffff',
  warningSubtle: '#faf0bf',
  warningText: '#5a3f00',
  danger: '#991b1b',
  onDanger: '#ffffff',
  dangerSubtle: '#fee2e2',
  dangerText: '#7f1d1d',
};

/** Kitchen display, dark (`kds.theme` = DARK): deep ink surfaces, cream text, gold accents, AAA text. */
const kdsDark: ColorRoles = {
  background: '#20223d',
  surface: '#272a48',
  surfaceRaised: '#2c2f50',
  surfaceSunken: '#191b31',
  border: '#40436a',
  borderStrong: '#a7a7bd',
  text: '#fbf7f0',
  textMuted: '#d6d2c8',
  textDisabled: '#7b7c96',
  textInverse: '#20223d',
  primary: '#f5a623',
  primaryHover: '#f7b64a',
  primaryActive: '#f9c570',
  onPrimary: '#20223d',
  accent: '#f5a623',
  onAccent: '#20223d',
  highlight: '#f5a623',
  onHighlight: '#20223d',
  highlightSubtle: '#4a3a1c',
  highlightText: '#fde0a8',
  link: '#c3ccf5',
  divider: '#f5a623',
  focusRing: '#f7c567',
  overlay: 'rgb(14 15 28 / 0.75)',
  neutral: '#b3b4c8',
  onNeutral: '#20223d',
  neutralSubtle: '#40436a',
  neutralText: '#f0eee8',
  info: '#a9b6f0',
  onInfo: '#20223d',
  infoSubtle: '#2b3468',
  infoText: '#e0e5fa',
  success: '#3ddc9c',
  onSuccess: '#20223d',
  successSubtle: '#17453a',
  successText: '#c9f5e2',
  warning: '#f7e37f',
  onWarning: '#20223d',
  warningSubtle: '#524818',
  warningText: '#fbf2c0',
  danger: '#ff8a7f',
  onDanger: '#20223d',
  dangerSubtle: '#662430',
  dangerText: '#fdd9d5',
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
