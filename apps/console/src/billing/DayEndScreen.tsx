import type { DayEndOpenShift, DayEndPreview } from '@rp/contracts';
import { cashVariance, formatDisplayDate, formatRupees } from '@rp/domain';
import { paiseFromInput } from '@rp/ordering';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Icon,
  LoadingState,
  Money,
  TextField,
  useToast,
} from '@rp/ui-web';
import { useState } from 'react';
import { useConsole, useConsoleState } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { messageOf } from '../app/messages.js';
import { grantOf } from '../app/modes.js';
import { useLive } from '../app/use-live.js';

const affectsDay = (type: string) => /^(Bill|Order|Table|ItemStatusChanged$)/.test(type);

/**
 * Closing the business day (BILL-013): the Z-report of the day so far, what blocks closing (unpaid
 * takeaway bills, open tables, which the manager may carry forward), and the close. Shifts still
 * open are named, each to count and close or close as not counted, but do not block (ADR-0029).
 */
export function DayEndScreen({
  onBack,
  onPay,
}: {
  onBack: () => void;
  /** Opens an unpaid bill that holds the day up, to take its payment (QA-031). */
  onPay: (invoiceId: string) => void;
}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const { data, reload } = useLive(() => controller.api.previewDayEnd(), affectsDay);
  const [carryForward, setCarryForward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Closing a day cannot be undone: it asks first (QA-030).
  const [confirming, setConfirming] = useState(false);

  const close = async (preview: DayEndPreview) => {
    setBusy(true);
    setError(undefined);
    try {
      await controller.api.closeDay({
        body: { businessDate: preview.businessDate, carryForwardTables: carryForward },
      });
      toast.show({
        title: t('dayEnd.closedToast', { date: formatDisplayDate(preview.businessDate) }),
        tone: 'success',
      });
    } catch (failure) {
      setError(messageOf(failure, t));
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <section className="pos-order" aria-labelledby="day-end-title">
      <header className="pos-order__header">
        <Button variant="ghost" startIcon={<Icon name="close" />} onClick={onBack}>
          {t('pos.backToTables')}
        </Button>
        <h2 id="day-end-title" className="pos-floor__heading">
          {data.status === 'ready'
            ? t('dayEnd.title', { date: formatDisplayDate(data.value.businessDate) })
            : t('dayEnd.open')}
        </h2>
      </header>
      {data.status === 'loading' ? <LoadingState title={t('states.loading')} /> : null}
      {data.status === 'error' ? (
        <ErrorState
          title={messageOf(data.error, t)}
          action={<Button onClick={reload}>{t('states.retry')}</Button>}
        />
      ) : null}
      {data.status === 'ready' ? (
        <div className="bill">
          <ZReport preview={data.value} />
          <div className="bill__panel">
            {error === undefined ? null : (
              <p role="alert" className="console-notice console-notice--danger">
                {error}
              </p>
            )}
            <Blockers preview={data.value} onPay={onPay} />
            {data.value.openShifts.length > 0 && data.value.status === 'OPEN' ? (
              <OpenShifts shifts={data.value.openShifts} onChanged={reload} />
            ) : null}
            {data.value.status === 'CLOSED' ? (
              <p className="console-notice">{t('dayEnd.closed')}</p>
            ) : (
              <>
                {data.value.blockers.openTables.length > 0 ? (
                  <label className="console-check">
                    <input
                      type="checkbox"
                      checked={carryForward}
                      onChange={(event) => {
                        setCarryForward(event.target.checked);
                      }}
                    />
                    {t('dayEnd.carryForward')}
                  </label>
                ) : null}
                <Button
                  variant="danger"
                  size="lg"
                  loading={busy}
                  // Closed only once nothing stands in the way (P9-24).
                  disabled={!canClose(data.value, carryForward)}
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  {t('dayEnd.close')}
                </Button>
                <ConfirmDialog
                  open={confirming}
                  title={t('dayEnd.confirmTitle', {
                    date: formatDisplayDate(data.value.businessDate),
                  })}
                  description={t('dayEnd.confirmDescription')}
                  confirmLabel={t('dayEnd.close')}
                  cancelLabel={t('dayEnd.keepOpen')}
                  tone="danger"
                  busy={busy}
                  onCancel={() => {
                    setConfirming(false);
                  }}
                  onConfirm={() => {
                    setConfirming(false);
                    void close(data.value);
                  }}
                />
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Whether the day can be closed: no bill unpaid, open tables carried forward. */
function canClose(preview: DayEndPreview, carryForward: boolean): boolean {
  const { openTables, unsettledInvoices } = preview.blockers;
  return unsettledInvoices.length === 0 && (openTables.length === 0 || carryForward);
}

function Blockers({
  preview,
  onPay,
}: {
  preview: DayEndPreview;
  onPay: (invoiceId: string) => void;
}) {
  const t = useT();
  const { openTables, unsettledInvoices } = preview.blockers;
  const none = openTables.length + unsettledInvoices.length === 0;
  return (
    <Card title={t('dayEnd.blockers')} headingLevel={3}>
      {none ? <p>{t('dayEnd.noBlockers')}</p> : null}
      <ul className="bill__discounts">
        {openTables.length > 0 ? (
          <li>
            {t('dayEnd.openTables', {
              tables: openTables.map((table) => table.tableLabel).join(', '),
            })}
          </li>
        ) : null}
        {unsettledInvoices.length > 0 ? (
          <li>
            {t('dayEnd.unsettled', {
              invoices: unsettledInvoices.map((invoice) => invoice.invoiceNumber).join(', '),
            })}
          </li>
        ) : null}
        {unsettledInvoices.map((invoice) => (
          <li key={invoice.invoiceId}>
            <Button
              variant="secondary"
              onClick={() => {
                onPay(invoice.invoiceId);
              }}
            >
              {t('dayEnd.payInvoice', { number: invoice.invoiceNumber })}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The shifts still open at day end (ADR-0029): none of them holds up closing the day. */
function OpenShifts({
  shifts,
  onChanged,
}: {
  shifts: readonly DayEndOpenShift[];
  onChanged: () => void;
}) {
  const t = useT();
  return (
    <Card title={t('dayEnd.shiftsTitle')} headingLevel={3}>
      <p className="dashboard-section__hint">{t('dayEnd.shiftsRunOn')}</p>
      {shifts.map((shift) => (
        <OpenShiftRow key={shift.shiftId} shift={shift} onChanged={onChanged} />
      ))}
    </Card>
  );
}

function OpenShiftRow({ shift, onChanged }: { shift: DayEndOpenShift; onChanged: () => void }) {
  const t = useT();
  const controller = useConsole();
  const { person } = useConsoleState();
  const toast = useToast();
  const [counting, setCounting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const name = shift.staffName;
  // The server decides again; this only leaves out what would be refused.
  const grant = person === undefined ? 'DENY' : grantOf(person, 'CASH_MOVEMENT_AND_SHIFT_CLOSE');
  const mayClose = grant === 'ALLOW' || (grant === 'OWN' && person?.id === shift.staffId);
  const paise = counted.trim() === '0' ? 0 : paiseFromInput(counted);

  const act = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(undefined);
    try {
      toast.show({ title: await action(), tone: 'success' });
      onChanged();
    } catch (failure) {
      setError(messageOf(failure, t));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const countAndClose = () => {
    if (paise === undefined) {
      setError(t('shift.invalidAmount'));
      return;
    }
    void act(async () => {
      const closed = await controller.api.closeShift({
        params: { id: shift.shiftId },
        body: { countedCash: paise },
      });
      return t('shift.closed', { variance: formatRupees(closed.variance ?? 0) });
    });
  };

  return (
    <div className="console-form">
      <p>
        <strong>{t('dayEnd.shiftOpen', { name })}</strong>
        <br />
        {t('dayEnd.shiftExpected', { amount: formatRupees(shift.expectedCash) })}
      </p>
      {error === undefined ? null : (
        <p role="alert" className="console-notice console-notice--danger">
          {error}
        </p>
      )}
      {mayClose && counting ? (
        <form
          className="console-form"
          onSubmit={(event) => {
            event.preventDefault();
            countAndClose();
          }}
        >
          <TextField
            label={t('shift.counted')}
            inputMode="decimal"
            value={counted}
            onChange={(event) => {
              setCounted(event.target.value);
            }}
          />
          {paise === undefined ? null : (
            <p role="status">
              {t('dayEnd.difference', {
                variance: formatRupees(cashVariance(paise, shift.expectedCash)),
              })}
            </p>
          )}
          <Button type="submit" loading={busy}>
            {t('dayEnd.countAndClose')}
          </Button>
        </form>
      ) : null}
      {mayClose && !counting ? (
        <Button
          variant="secondary"
          aria-label={t('dayEnd.countOf', { name })}
          onClick={() => {
            setCounting(true);
          }}
        >
          {t('dayEnd.count')}
        </Button>
      ) : null}
      {mayClose ? (
        <Button
          variant="ghost"
          aria-label={t('dayEnd.notCountedOf', { name })}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t('dayEnd.notCounted')}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={t('dayEnd.notCountedTitle', { name })}
        description={t('dayEnd.notCountedDescription')}
        confirmLabel={t('dayEnd.notCountedConfirm')}
        cancelLabel={t('dayEnd.notCountedCancel')}
        busy={busy}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void act(async () => {
            await controller.api.closeShiftNotCounted({ params: { id: shift.shiftId } });
            return t('dayEnd.notCountedDone', { name });
          });
        }}
      />
    </div>
  );
}

function ZReport({ preview }: { preview: DayEndPreview }) {
  const t = useT();
  const { report } = preview;
  return (
    <Card title={t('dayEnd.report')} headingLevel={3}>
      <dl className="bill__totals">
        <dt>{t('dayEnd.orders')}</dt>
        <dd>{report.orders}</dd>
        <dt>{t('dayEnd.invoices')}</dt>
        <dd>{report.invoices.count}</dd>
        {report.invoices.voided.length > 0 ? (
          <>
            <dt>{t('dayEnd.voidedInvoices')}</dt>
            <dd>{report.invoices.voided.join(', ')}</dd>
          </>
        ) : null}
        <Row label={t('dayEnd.grossSales')} paise={report.grossSales} />
        <Row label={t('dayEnd.discounts')} paise={-report.discounts} />
        <Row label={t('dayEnd.serviceCharge')} paise={report.serviceCharge} />
        <Row label={t('dayEnd.tax')} paise={report.taxTotal} />
        <dt className="bill__grand">{t('dayEnd.netSales')}</dt>
        <dd className="bill__grand">
          <Money paise={report.netSales} strong />
        </dd>
        <Row label={t('dayEnd.settledSales')} paise={report.settledSales} />
      </dl>
      <h4>{t('dayEnd.payments')}</h4>
      <dl className="bill__totals">
        {report.payments.map((payment) => (
          <Row
            key={`${payment.mode}-${payment.label ?? ''}`}
            label={`${payment.label ?? t(`payment.modes.${payment.mode}`)} (${String(payment.count)})`}
            paise={payment.amount}
          />
        ))}
        <Row label={t('dayEnd.outsideShift')} paise={report.cash.outsideShift} />
        <Row label={t('dayEnd.variance')} paise={report.totalVariance} />
      </dl>
    </Card>
  );
}

function Row({ label, paise }: { label: string; paise: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <Money paise={paise} signTone />
      </dd>
    </>
  );
}
