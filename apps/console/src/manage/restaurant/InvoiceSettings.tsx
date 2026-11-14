import type { InvoiceSeriesView, RestaurantProfile } from '@rp/contracts';
import { normaliseGstin } from '@rp/domain';
import { Badge, Button, ErrorState, LoadingState, Select, TextField, useToast } from '@rp/ui-web';
import { type ReactNode, useEffect, useState } from 'react';
import { useConsole, useConsoleState } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { grantOf } from '../../app/modes.js';
import { useLive } from '../../app/use-live.js';
import {
  BILL_LINES,
  BILL_SETTING_KEYS,
  type BillSettings,
  billSettingChanges,
  type InvoiceSettingsDraft,
  invoiceDraftOf,
  previewRequestOf,
  seriesSwitchWarning,
} from './invoice-settings-view.js';
import { FormDialog, STATE_OPTIONS } from './RestaurantDialogs.js';
import {
  checkLegalDraft,
  legalDraftOf,
  legalRequestOf,
  profileDraftOf,
  profileRequestOf,
} from './restaurant-view.js';

/** How long the preview waits after the last key press before asking for a new one, in ms. */
const PREVIEW_DELAY_MS = 350;

interface InvoiceData {
  readonly profile: RestaurantProfile;
  readonly series: readonly InvoiceSeriesView[];
  readonly settings: BillSettings;
}

/** The restaurant, its series and its bill settings, read again when any of them changes. */
function useInvoiceData() {
  const controller = useConsole();
  return useLive(
    async (): Promise<InvoiceData> => {
      const [profile, series, settings] = await Promise.all([
        controller.api.getRestaurant(),
        controller.api.listInvoiceSeries(),
        controller.api.listSettings(),
      ]);
      const values = new Map(settings.settings.map((entry) => [entry.key, entry.value]));
      return {
        profile,
        series: series.invoiceSeries.filter((entry) => entry.archivedAt === null),
        settings: Object.fromEntries(
          BILL_SETTING_KEYS.map((key) => [key, values.get(key)]),
        ) as BillSettings,
      };
    },
    (type) => type === 'RestaurantChanged' || type === 'SettingsChanged',
  );
}

/** The printed bill for what the draft says, asked for again a moment after each change. */
function usePreview(draft: InvoiceSettingsDraft, series: readonly InvoiceSeriesView[]) {
  const controller = useConsole();
  const [lines, setLines] = useState<readonly string[] | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  const t = useT();
  const request = JSON.stringify(previewRequestOf(draft, series));
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      controller.api.previewInvoice({ body: JSON.parse(request) as never }).then(
        (answer) => {
          if (!live) return;
          setLines(answer.lines);
          setFailed(undefined);
        },
        (error: unknown) => {
          if (live) setFailed(messageOf(error, t));
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [controller, request, t]);
  return { lines, failed };
}

/** A bill as the printer prints it, 48 characters a line (ADR-0031). */
export function BillPaper({
  draft,
  series,
}: {
  draft: InvoiceSettingsDraft;
  series: readonly InvoiceSeriesView[];
}) {
  const t = useT();
  const { lines, failed } = usePreview(draft, series);
  return (
    <figure className="bill-paper" aria-label={t('invoiceSettings.preview')}>
      <figcaption className="bill-paper__caption">{t('invoiceSettings.preview')}</figcaption>
      {failed !== undefined ? (
        <p className="console-notice console-notice--danger">{failed}</p>
      ) : lines === undefined ? (
        <LoadingState title={t('states.loading')} />
      ) : (
        <pre className="bill-paper__text">{lines.join('\n')}</pre>
      )}
    </figure>
  );
}

/**
 * The bill as it prints now, for the set-up step's "Confirm how invoices look" (ADR-0031), with
 * the way to the invoice settings.
 */
export function SavedBillPreview() {
  const { data } = useInvoiceData();
  if (data.status !== 'ready') return null;
  const { profile, settings, series } = data.value;
  return <BillPaper draft={invoiceDraftOf(profile, settings, series)} series={series} />;
}

/**
 * Invoice settings on the Restaurant page (ADR-0031): everything the set-up step asks the Owner
 * to confirm about the bill in one place, with the printed bill beside it. Only the Owner
 * changes them (TAX_AND_INVOICE_SETTINGS); others see them and the preview.
 */
export function InvoiceSettings() {
  const t = useT();
  const { person } = useConsoleState();
  const owner = person !== undefined && grantOf(person, 'TAX_AND_INVOICE_SETTINGS') !== 'DENY';
  const { data, reload } = useInvoiceData();
  const [editing, setEditing] = useState(false);

  let body: ReactNode;
  if (data.status === 'loading') body = <LoadingState title={t('states.loading')} />;
  else if (data.status === 'error') {
    body = (
      <ErrorState
        title={t('restaurantPage.loadFailed')}
        description={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  } else {
    const { profile, settings, series } = data.value;
    const draft = invoiceDraftOf(profile, settings, series);
    body = (
      <>
        <BillPaper draft={draft} series={series} />
        {editing ? (
          <InvoiceSettingsDialog
            data={data.value}
            onClose={() => {
              setEditing(false);
            }}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <section className="device-group" aria-labelledby="restaurant-invoice">
      <div className="staff-header">
        <h3 id="restaurant-invoice" className="device-group__heading">
          {t('invoiceSettings.title')}
        </h3>
        {owner ? (
          <Button
            variant="secondary"
            disabled={data.status !== 'ready'}
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('invoiceSettings.edit')}
          </Button>
        ) : null}
      </div>
      <p className="dashboard-section__hint">
        {t('invoiceSettings.hint')} <Badge tone="warning">{t('restaurantPage.ownerOnly')}</Badge>
      </p>
      {body}
    </section>
  );
}

function InvoiceSettingsDialog({
  data,
  onClose,
  onSaved,
}: {
  data: InvoiceData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const { profile, series, settings } = data;
  const [draft, setDraft] = useState<InvoiceSettingsDraft>(() =>
    invoiceDraftOf(profile, settings, series),
  );
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const legalProblems = checkLegalDraft(draft.legal);
  const switching = seriesSwitchWarning(series, draft.seriesId);

  const set = (patch: Partial<InvoiceSettingsDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setLegal = (patch: Partial<InvoiceSettingsDraft['legal']>) => {
    setDraft((current) => ({ ...current, legal: { ...current.legal, ...patch } }));
  };
  const setLine = (which: 'headerLines' | 'footerLines', index: number, text: string) => {
    setDraft((current) => ({
      ...current,
      [which]: current[which].map((line, at) => (at === index ? text : line)),
    }));
  };

  const save = async () => {
    setSubmitted(true);
    if (legalProblems.length > 0) {
      setError(t('invoiceSettings.fixProblems'));
      return;
    }
    if (switching && !confirmed) {
      setError(t('invoiceSettings.series.confirmFirst'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const why = reason.trim();
      const legalBefore = JSON.stringify(legalDraftOf(profile));
      if (JSON.stringify(draft.legal) !== legalBefore) {
        const request = legalRequestOf(draft.legal, why);
        if (request === undefined) throw new Error(t('invoiceSettings.fixProblems'));
        await controller.api.updateRestaurantLegal({ body: request });
      }
      const before = profileDraftOf(profile);
      if (
        draft.profile.displayName !== before.displayName ||
        draft.profile.phone !== before.phone
      ) {
        const request = profileRequestOf(
          { ...before, displayName: draft.profile.displayName, phone: draft.profile.phone },
          why,
        );
        if (request === undefined) throw new Error(t('invoiceSettings.fixProblems'));
        await controller.api.updateRestaurantProfile({ body: request });
      }
      for (const [key, value] of billSettingChanges(draft, settings)) {
        await controller.api.updateSetting({
          params: { key },
          body: { value, ...(why !== '' && { reason: why }) },
        });
      }
      if (series.find((entry) => entry.isDefault)?.id !== draft.seriesId) {
        await controller.api.setDefaultInvoiceSeries({ params: { seriesId: draft.seriesId } });
      }
      toast.show({ title: t('invoiceSettings.saved'), tone: 'success' });
      onSaved();
    } catch (failure) {
      setError(messageOf(failure, t));
      setBusy(false);
    }
  };

  const problem = (...kinds: string[]) => {
    const found = legalProblems.find((entry) => kinds.includes(entry));
    return submitted && found !== undefined ? t(`restaurantPage.problems.${found}`) : undefined;
  };

  return (
    <FormDialog
      title={t('invoiceSettings.dialogTitle')}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={() => {
        void save();
      }}
      reason={reason}
      onReason={setReason}
    >
      <div className="invoice-settings">
        <div className="invoice-settings__form">
          <h4 className="invoice-settings__group">{t('invoiceSettings.who')}</h4>
          <TextField
            label={t('restaurantPage.profile.displayName')}
            value={draft.profile.displayName}
            maxLength={60}
            onChange={(event) => {
              set({ profile: { ...draft.profile, displayName: event.target.value } });
            }}
          />
          <TextField
            label={t('restaurantPage.legal.legalName')}
            value={draft.legal.legalName}
            maxLength={120}
            error={problem('LEGAL_NAME_REQUIRED')}
            onChange={(event) => {
              setLegal({ legalName: event.target.value });
            }}
          />
          <TextField
            label={t('restaurantPage.legal.line1')}
            value={draft.legal.line1}
            maxLength={120}
            error={problem('LINE1_REQUIRED')}
            onChange={(event) => {
              setLegal({ line1: event.target.value });
            }}
          />
          <TextField
            label={t('restaurantPage.legal.line2')}
            value={draft.legal.line2}
            maxLength={120}
            onChange={(event) => {
              setLegal({ line2: event.target.value });
            }}
          />
          <div className="menu-form__row">
            <TextField
              label={t('restaurantPage.legal.city')}
              value={draft.legal.city}
              maxLength={60}
              error={problem('CITY_REQUIRED')}
              onChange={(event) => {
                setLegal({ city: event.target.value });
              }}
            />
            <TextField
              label={t('restaurantPage.legal.pincode')}
              value={draft.legal.pincode}
              maxLength={6}
              inputMode="numeric"
              error={problem('PINCODE_INVALID')}
              onChange={(event) => {
                setLegal({ pincode: event.target.value });
              }}
            />
          </div>
          <TextField
            label={t('restaurantPage.profile.phone')}
            value={draft.profile.phone}
            maxLength={20}
            onChange={(event) => {
              set({ profile: { ...draft.profile, phone: event.target.value } });
            }}
          />
          <h4 className="invoice-settings__group">{t('invoiceSettings.tax')}</h4>
          <Select
            label={t('restaurantPage.legal.state')}
            placeholder={t('restaurantPage.legal.chooseState')}
            value={draft.legal.stateCode}
            options={STATE_OPTIONS}
            error={problem('STATE_REQUIRED')}
            onChange={(event) => {
              setLegal({ stateCode: event.target.value });
            }}
          />
          <TextField
            label={t('restaurantPage.legal.gstin')}
            hint={t('restaurantPage.legal.gstinHint')}
            value={draft.legal.gstin}
            maxLength={20}
            spellCheck={false}
            error={problem(
              'GSTIN_FORMAT',
              'GSTIN_STATE_CODE',
              'GSTIN_CHECKSUM',
              'GSTIN_OTHER_STATE',
            )}
            onChange={(event) => {
              setLegal({ gstin: event.target.value });
            }}
            onBlur={() => {
              setLegal({ gstin: normaliseGstin(draft.legal.gstin) });
            }}
          />
          <TextField
            label={t('restaurantPage.legal.fssai')}
            value={draft.legal.fssai}
            maxLength={14}
            inputMode="numeric"
            error={problem('FSSAI_INVALID')}
            onChange={(event) => {
              setLegal({ fssai: event.target.value });
            }}
          />
          <Select
            label={t('invoiceSettings.series.label')}
            hint={t('invoiceSettings.series.hint')}
            value={draft.seriesId}
            options={series.map((entry) => ({
              value: entry.id,
              label: `${entry.name} (${entry.example})`,
            }))}
            onChange={(event) => {
              set({ seriesId: event.target.value });
              setConfirmed(false);
            }}
          />
          {switching ? (
            <div className="console-notice console-notice--warning">
              <p>{t('invoiceSettings.series.warning')}</p>
              <label className="menu-toolbar__check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => {
                    setConfirmed(event.target.checked);
                  }}
                />
                {t('invoiceSettings.series.confirm')}
              </label>
            </div>
          ) : null}
          <h4 className="invoice-settings__group">{t('invoiceSettings.text')}</h4>
          {Array.from({ length: BILL_LINES }, (_, index) => (
            <TextField
              key={`header-${String(index)}`}
              label={t('invoiceSettings.headerLine', { number: index + 1 })}
              value={draft.headerLines[index] ?? ''}
              maxLength={48}
              onChange={(event) => {
                setLine('headerLines', index, event.target.value);
              }}
            />
          ))}
          {Array.from({ length: BILL_LINES }, (_, index) => (
            <TextField
              key={`footer-${String(index)}`}
              label={t('invoiceSettings.footerLine', { number: index + 1 })}
              value={draft.footerLines[index] ?? ''}
              maxLength={48}
              onChange={(event) => {
                setLine('footerLines', index, event.target.value);
              }}
            />
          ))}
          <TextField
            label={t('invoiceSettings.thankYou')}
            hint={t('invoiceSettings.thankYouHint')}
            value={draft.thankYouLine}
            maxLength={60}
            onChange={(event) => {
              set({ thankYouLine: event.target.value });
            }}
          />
          <h4 className="invoice-settings__group">{t('invoiceSettings.print')}</h4>
          {(
            [
              ['printPhone', 'invoiceSettings.printPhone'],
              ['printFssai', 'invoiceSettings.printFssai'],
              ['amountInWords', 'invoiceSettings.amountInWords'],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="menu-toolbar__check">
              <input
                type="checkbox"
                checked={draft[name]}
                onChange={(event) => {
                  set({ [name]: event.target.checked });
                }}
              />
              {t(label)}
            </label>
          ))}
        </div>
        <BillPaper draft={draft} series={series} />
      </div>
    </FormDialog>
  );
}
