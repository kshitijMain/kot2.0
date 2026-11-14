import type { InvoicePreviewRequest, InvoiceSeriesView, RestaurantProfile } from '@rp/contracts';
import { normaliseGstin } from '@rp/domain';
import {
  type LegalDraft,
  legalDraftOf,
  type ProfileDraft,
  profileDraftOf,
} from './restaurant-view.js';

/** The bill settings the invoice settings page edits (ADR-0031). */
export const BILL_SETTING_KEYS = [
  'bills.headerLines',
  'bills.footerLines',
  'bills.thankYouLine',
  'bills.printPhone',
  'bills.printFssai',
  'bills.amountInWords',
] as const;
export type BillSettingKey = (typeof BILL_SETTING_KEYS)[number];

/** Header and footer lines the page offers: as many as the settings allow. */
export const BILL_LINES = 4;

/** Every bill setting's current value, by key. */
export type BillSettings = Readonly<Record<BillSettingKey, unknown>>;

/**
 * Everything the set-up step asks the Owner to confirm about the bill, as the page holds it while
 * it is typed (ADR-0031): the name and phone, the legal particulars, the default series, the
 * header and footer lines, the thank-you line and what else to print.
 */
export interface InvoiceSettingsDraft {
  readonly profile: ProfileDraft;
  readonly legal: LegalDraft;
  readonly seriesId: string;
  readonly headerLines: readonly string[];
  readonly footerLines: readonly string[];
  readonly thankYouLine: string;
  readonly printPhone: boolean;
  readonly printFssai: boolean;
  readonly amountInWords: boolean;
}

const lines = (value: unknown): string[] => {
  const given = Array.isArray(value)
    ? value.filter((line): line is string => typeof line === 'string')
    : [];
  return Array.from({ length: BILL_LINES }, (_, index) => given[index] ?? '');
};

export function invoiceDraftOf(
  profile: RestaurantProfile,
  settings: BillSettings,
  series: readonly InvoiceSeriesView[],
): InvoiceSettingsDraft {
  return {
    profile: profileDraftOf(profile),
    legal: legalDraftOf(profile),
    seriesId: series.find((entry) => entry.isDefault)?.id ?? series[0]?.id ?? '',
    headerLines: lines(settings['bills.headerLines']),
    footerLines: lines(settings['bills.footerLines']),
    thankYouLine:
      typeof settings['bills.thankYouLine'] === 'string' ? settings['bills.thankYouLine'] : '',
    printPhone: settings['bills.printPhone'] !== false,
    printFssai: settings['bills.printFssai'] !== false,
    amountInWords: settings['bills.amountInWords'] !== false,
  };
}

const filled = (texts: readonly string[]) =>
  texts.map((text) => text.trim()).filter((text) => text !== '');
const orNull = (text: string) => (text.trim() === '' ? null : text.trim());

/** The preview of the bill as it is being typed, with the chosen series' first number. */
export function previewRequestOf(
  draft: InvoiceSettingsDraft,
  series: readonly InvoiceSeriesView[],
): InvoicePreviewRequest {
  const { legal } = draft;
  const gstin = normaliseGstin(legal.gstin);
  return {
    displayName: draft.profile.displayName.trim() === '' ? '-' : draft.profile.displayName.trim(),
    legalName: orNull(legal.legalName),
    address:
      legal.line1.trim() === '' || legal.city.trim() === ''
        ? null
        : {
            line1: legal.line1.trim(),
            ...(legal.line2.trim() !== '' && { line2: legal.line2.trim() }),
            city: legal.city.trim(),
            pincode: legal.pincode.trim(),
          },
    phone: orNull(draft.profile.phone),
    stateCode: orNull(legal.stateCode),
    gstin: gstin === '' ? null : gstin.slice(0, 15),
    fssaiNumber: orNull(legal.fssai),
    headerLines: filled(draft.headerLines),
    footerLines: filled(draft.footerLines),
    thankYouLine: draft.thankYouLine.trim(),
    printPhone: draft.printPhone,
    printFssai: draft.printFssai,
    amountInWords: draft.amountInWords,
    invoiceNumber:
      series.find((entry) => entry.id === draft.seriesId)?.example ?? series[0]?.example ?? 'INV/1',
  };
}

/** The bill settings to change, as [key, value], leaving out the ones that are unchanged. */
export function billSettingChanges(
  draft: InvoiceSettingsDraft,
  settings: BillSettings,
): [BillSettingKey, unknown][] {
  const wanted: Record<BillSettingKey, unknown> = {
    'bills.headerLines': filled(draft.headerLines),
    'bills.footerLines': filled(draft.footerLines),
    'bills.thankYouLine': draft.thankYouLine.trim(),
    'bills.printPhone': draft.printPhone,
    'bills.printFssai': draft.printFssai,
    'bills.amountInWords': draft.amountInWords,
  };
  return BILL_SETTING_KEYS.filter(
    (key) => JSON.stringify(wanted[key]) !== JSON.stringify(settings[key]),
  ).map((key) => [key, wanted[key]]);
}

/**
 * Whether choosing another default series needs a warning (D-41): the current one has numbered
 * bills, so from now on bills carry the other series' numbers part way through the year.
 */
export function seriesSwitchWarning(
  series: readonly InvoiceSeriesView[],
  chosenId: string,
): boolean {
  const current = series.find((entry) => entry.isDefault);
  return current !== undefined && current.id !== chosenId && current.invoiceCount > 0;
}
