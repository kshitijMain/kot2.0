import { describe, expect, it } from 'vitest';
import {
  BILL_SETTING_KEYS,
  billSettingChanges,
  invoiceDraftOf,
  previewRequestOf,
  seriesSwitchWarning,
} from '../src/manage/restaurant/invoice-settings-view.js';
import { profileView, seriesViews, TAKEAWAY, DINE_IN } from './restaurant-fixture.js';

const SETTINGS = {
  'bills.headerLines': ['Pure veg kitchen'],
  'bills.footerLines': [],
  'bills.thankYouLine': 'Thank you for dining at {restaurant}!',
  'bills.printPhone': true,
  'bills.printFssai': true,
  'bills.amountInWords': true,
};

describe('[BILL-002] [ONB-004] invoice settings as the page holds them (ADR-0031)', () => {
  it('starts from the restaurant, its bill settings and its default series', () => {
    const draft = invoiceDraftOf(profileView(), SETTINGS, seriesViews());
    expect(draft.profile.displayName).toBe('Spice Route');
    expect(draft.legal.gstin).toBe('27AAPFU0939F1ZV');
    expect(draft.headerLines).toEqual(['Pure veg kitchen', '', '', '']);
    expect(draft.footerLines).toEqual(['', '', '', '']);
    expect(draft.seriesId).toBe(DINE_IN);
  });

  it('asks for a preview of exactly what is typed, with the chosen series’ number', () => {
    const draft = {
      ...invoiceDraftOf(profileView(), SETTINGS, seriesViews()),
      seriesId: TAKEAWAY,
      printPhone: false,
    };
    const request = previewRequestOf(draft, seriesViews());
    expect(request).toMatchObject({
      displayName: 'Spice Route',
      legalName: 'Spice Route Foods Private Limited',
      stateCode: '27',
      headerLines: ['Pure veg kitchen'],
      footerLines: [],
      printPhone: false,
      invoiceNumber: seriesViews().find((entry) => entry.id === TAKEAWAY)?.example,
    });
  });

  it('changes only the bill settings that differ', () => {
    const draft = {
      ...invoiceDraftOf(profileView(), SETTINGS, seriesViews()),
      footerLines: ['Open 11 to 11', '', '', ''],
      thankYouLine: 'Thank you for dining at {restaurant}!',
    };
    expect(billSettingChanges(draft, SETTINGS)).toEqual([['bills.footerLines', ['Open 11 to 11']]]);
    expect(BILL_SETTING_KEYS).toContain('bills.thankYouLine');
  });

  it('warns before another series takes over once the current one has numbered bills', () => {
    const series = seriesViews();
    const current = series.find((entry) => entry.isDefault);
    expect(current?.invoiceCount).toBeGreaterThan(0);
    expect(seriesSwitchWarning(series, TAKEAWAY)).toBe(true);
    expect(seriesSwitchWarning(series, current?.id ?? '')).toBe(false);
    expect(
      seriesSwitchWarning(
        series.map((entry) => ({ ...entry, invoiceCount: 0 })),
        TAKEAWAY,
      ),
    ).toBe(false);
  });
});
