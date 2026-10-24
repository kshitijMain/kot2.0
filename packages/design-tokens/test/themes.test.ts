import { describe, expect, it } from 'vitest';
import {
  type ColorRoles,
  contrastRatio,
  DARK_THEMES,
  KDS_THEMES,
  kdsFontSize,
  fontSize,
  relativeLuminance,
  THEME_NAMES,
  themes,
  TONES,
  touchTarget,
} from '../src/index.js';

type Role = keyof ColorRoles;
const SURFACES: Role[] = ['background', 'surface', 'surfaceRaised', 'surfaceSunken'];
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;
const AAA_TEXT = 7;

describe('[NFR-U01] [NFR-U02] themes', () => {
  it('provides light, dark and the two kitchen themes with the same roles', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark', 'kds', 'kds-dark']);
    const roles = Object.keys(themes.light).sort();
    for (const theme of THEME_NAMES) expect(Object.keys(themes[theme]).sort()).toEqual(roles);
  });

  it('marks dark and KDS dark as dark themes and makes their backgrounds actually dark', () => {
    expect(DARK_THEMES).toEqual(['dark', 'kds-dark']);
    for (const theme of THEME_NAMES.filter((name) => !DARK_THEMES.includes(name))) {
      expect(relativeLuminance(themes[theme].background)).toBeGreaterThan(0.8);
    }
    for (const theme of DARK_THEMES) {
      expect(relativeLuminance(themes[theme].background)).toBeLessThan(0.05);
    }
  });

  it('has an accent slot that defaults to the primary colour', () => {
    for (const theme of THEME_NAMES) {
      expect(themes[theme].accent).toBe(themes[theme].primary);
      expect(themes[theme].onAccent).toBe(themes[theme].onPrimary);
    }
  });
});

describe.each(THEME_NAMES)('[NFR-U05] WCAG 2.2 AA contrast in the %s theme', (name) => {
  const theme = themes[name];

  it.each(SURFACES)('body and muted text are readable on %s', (surface) => {
    expect(contrastRatio(theme.text, theme[surface])).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(theme.textMuted, theme[surface])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('text on primary and accent fills is readable in every interaction state', () => {
    for (const fill of ['primary', 'primaryHover', 'primaryActive'] as const) {
      expect(contrastRatio(theme.onPrimary, theme[fill])).toBeGreaterThanOrEqual(AA_TEXT);
    }
    expect(contrastRatio(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(TONES)('%s tone: solid, subtle and text colours are readable', (tone) => {
    const solid = theme[tone];
    const on = theme[`on${tone[0]!.toUpperCase()}${tone.slice(1)}` as Role];
    const subtle = theme[`${tone}Subtle` as Role];
    const text = theme[`${tone}Text` as Role];
    expect(contrastRatio(on, solid)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(text, subtle)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(text, theme.surface)).toBeGreaterThanOrEqual(AA_TEXT);
    // Solid fills used as indicators must stand out from the page (WCAG 1.4.11).
    expect(contrastRatio(solid, theme.background)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('the saffron highlight carries readable text and saffron text stays readable', () => {
    expect(contrastRatio(theme.onHighlight, theme.highlight)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(theme.highlightText, theme.highlightSubtle)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    for (const surface of SURFACES) {
      expect(contrastRatio(theme.highlightText, theme[surface])).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('keeps the status tones apart from the brand colours', () => {
    for (const tone of ['info', 'success', 'warning', 'danger'] as const) {
      expect(theme[tone]).not.toBe(theme.primary);
      expect(theme[tone]).not.toBe(theme.highlight);
      expect(theme[`${tone}Text`]).not.toBe(theme.highlightText);
    }
  });

  it.each(SURFACES)('control borders and the focus ring stand out on %s', (surface) => {
    expect(contrastRatio(theme.borderStrong, theme[surface])).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrastRatio(theme.focusRing, theme[surface])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('[KDS-011] kitchen display themes', () => {
  it('has a light default and a dark alternative', () => {
    expect(KDS_THEMES).toEqual(['kds', 'kds-dark']);
    expect(DARK_THEMES).not.toContain('kds');
    expect(DARK_THEMES).toContain('kds-dark');
  });

  it.each(KDS_THEMES)('meets AAA contrast for text in %s so tickets read from 2 m', (name) => {
    for (const surface of SURFACES) {
      expect(contrastRatio(themes[name].text, themes[name][surface])).toBeGreaterThanOrEqual(
        AAA_TEXT,
      );
      expect(contrastRatio(themes[name].textMuted, themes[name][surface])).toBeGreaterThanOrEqual(
        AAA_TEXT,
      );
    }
  });

  it('uses larger type than the standard scale at every step', () => {
    for (const key of Object.keys(fontSize) as (keyof typeof fontSize)[]) {
      expect(kdsFontSize[key]).toBeGreaterThan(fontSize[key]);
    }
  });

  it('uses touch targets larger than the 48 px minimum for gloved hands', () => {
    expect(touchTarget.kds).toBeGreaterThan(touchTarget.min);
  });
});

describe('[NFR-U03] touch targets', () => {
  it('never goes below 48 px', () => {
    expect(touchTarget.min).toBeGreaterThanOrEqual(48);
    expect(Math.min(...Object.values(touchTarget))).toBeGreaterThanOrEqual(48);
  });
});
