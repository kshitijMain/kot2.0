import type { BillHistoryEntry, BillHistoryInvoiceResponse, BillHistoryQuery } from '@rp/contracts';
import { displayDateTime } from '@rp/domain';
import { Badge, Button, Dialog, Table, TextField, useToast } from '@rp/ui-web';
import { useState } from 'react';
import { useConsole } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import type { ReportRange } from './report-view.js';
import { moneyColumn, ReportBody, ReportSection, textColumn } from './ReportParts.js';
import { useReport } from './use-report.js';

/** A number or phone searched for; none lists the chosen period. */
interface Search {
  readonly number: string;
  readonly phone: string;
}

const NO_SEARCH: Search = { number: '', phone: '' };

/** What to ask the server for: a search looks across all dates, otherwise the period. */
function queryOf(range: ReportRange, search: Search): BillHistoryQuery {
  const number = search.number.trim();
  const phone = search.phone.trim();
  if (number === '' && phone === '') return { from: range.from, to: range.to, limit: 50 };
  return {
    ...(number !== '' && { number }),
    ...(phone !== '' && { phone }),
    limit: 50,
  };
}

/** One bill as printed, to read or print again on the bill printer (a duplicate). */
function OpenedBill({
  opened,
  onClose,
}: {
  opened: BillHistoryInvoiceResponse;
  onClose: () => void;
}) {
  const t = useT();
  const { api } = useConsole();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { invoice } = opened;
  const voided = invoice.status === 'VOIDED';
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('history.billTitle', { number: invoice.invoiceNumber })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('history.close')}
          </Button>
          {voided ? null : (
            <Button
              loading={busy}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                api
                  .printInvoice({ params: { id: invoice.id }, body: {} })
                  .then(
                    (result) => {
                      toast.show(
                        result.printed
                          ? {
                              title: result.duplicate
                                ? t('history.reprinted')
                                : t('history.printed'),
                              tone: 'success',
                            }
                          : {
                              title: t('history.notPrinted', { error: result.error ?? '' }),
                              tone: 'warning',
                            },
                      );
                    },
                    (failure: unknown) => {
                      toast.show({
                        title: t('history.notPrinted', { error: messageOf(failure, t) }),
                        tone: 'warning',
                      });
                    },
                  )
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {t('history.printAgain')}
            </Button>
          )}
        </>
      }
    >
      {voided ? <p className="dashboard-section__hint">{t('history.voided')}</p> : null}
      <figure className="archive-invoice__figure" aria-label={t('history.printedText')}>
        <pre className="archive-invoice">{opened.printed.join('\n')}</pre>
      </figure>
    </Dialog>
  );
}

/**
 * The bill history (P9-27, DATA-012): every bill still on this PC, newest first, for the chosen
 * period or found by its number or the guest's phone across all dates, 50 at a time with "Show
 * more". A bill opens as printed and can be printed again. Older years are in their archive.
 */
export function BillHistory({ range }: { range: ReportRange }) {
  const t = useT();
  const { api } = useConsole();
  const toast = useToast();
  const [typed, setTyped] = useState<Search>(NO_SEARCH);
  const [search, setSearch] = useState<Search>(NO_SEARCH);
  const query = queryOf(range, search);
  const key = JSON.stringify(query);
  const { data, reload } = useReport(() => api.getBillHistory({ query }), range, key);
  // The pages read after the first, for this query; another query starts from its first page.
  const [more, setMore] = useState<
    | { readonly key: string; readonly invoices: BillHistoryEntry[]; readonly next: string | null }
    | undefined
  >();
  const [loadingMore, setLoadingMore] = useState(false);
  const [opened, setOpened] = useState<BillHistoryInvoiceResponse | undefined>();
  const searching = query.from === undefined;

  const open = (entry: BillHistoryEntry) => {
    api
      .getBillHistoryInvoice({ params: { id: entry.invoiceId } })
      .then(setOpened, (failure: unknown) => {
        toast.show({ title: messageOf(failure, t), tone: 'danger' });
      });
  };

  const where = (row: BillHistoryEntry) => {
    if (row.tableLabel !== null) return t('history.tableLabel', { table: row.tableLabel });
    if (row.takeawayToken !== null) return t('history.token', { token: row.takeawayToken });
    return t('history.takeaway');
  };

  const when = (row: BillHistoryEntry) => {
    const { date, time } = displayDateTime(new Date(row.issuedAt));
    return (
      <span className="audit-when">
        <span>{date}</span> <span>{time}</span>
      </span>
    );
  };

  return (
    <ReportSection id="report-bills" title={t('history.title')}>
      <p className="dashboard-section__hint">{t('history.intro')}</p>
      <form
        className="menu-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(typed);
        }}
      >
        <TextField
          label={t('history.number')}
          value={typed.number}
          maxLength={32}
          onChange={(event) => {
            setTyped({ ...typed, number: event.target.value });
          }}
        />
        <TextField
          label={t('history.phone')}
          type="tel"
          inputMode="tel"
          value={typed.phone}
          maxLength={24}
          onChange={(event) => {
            setTyped({ ...typed, phone: event.target.value });
          }}
        />
        <Button type="submit">{t('history.search')}</Button>
        {searching ? (
          <Button
            variant="ghost"
            onClick={() => {
              setTyped(NO_SEARCH);
              setSearch(NO_SEARCH);
            }}
          >
            {t('history.clear')}
          </Button>
        ) : null}
      </form>
      {searching ? <p className="dashboard-section__hint">{t('history.allDates')}</p> : null}
      <ReportBody data={data} reload={reload}>
        {(page) => {
          const extra = more?.key === key ? more : undefined;
          const invoices = [...page.invoices, ...(extra?.invoices ?? [])];
          const next = extra === undefined ? page.nextCursor : extra.next;
          return (
            <>
              <Table<BillHistoryEntry>
                caption={t('history.table')}
                columns={[
                  textColumn('number', t('history.column.number'), (row) => (
                    <Button
                      variant="ghost"
                      aria-label={t('history.openFor', { number: row.invoiceNumber })}
                      onClick={() => {
                        open(row);
                      }}
                    >
                      {row.invoiceNumber}
                    </Button>
                  )),
                  textColumn('when', t('history.column.when'), when),
                  textColumn('where', t('history.column.where'), where),
                  moneyColumn('total', t('history.column.total'), (row) => row.grandTotal),
                  textColumn('status', t('history.column.status'), (row) =>
                    row.status === 'VOIDED' ? (
                      <Badge tone="danger">{t('reportsPage.invoiceStatus.VOIDED')}</Badge>
                    ) : (
                      t(`reportsPage.invoiceStatus.${row.status}`)
                    ),
                  ),
                  textColumn('paidBy', t('history.column.paidBy'), (row) =>
                    row.payments.length === 0
                      ? t('history.notPaid')
                      : row.payments
                          .map((payment) =>
                            payment.mode === 'OTHER' && payment.label !== null
                              ? payment.label
                              : t(`reportsPage.paymentMode.${payment.mode}`),
                          )
                          .join(', '),
                  ),
                ]}
                rows={invoices}
                rowKey={(row) => row.invoiceId}
                empty={t('history.none')}
              />
              {invoices.length === 0 ? null : (
                <div className="staff-row__actions">
                  <p className="dashboard-section__hint">
                    {t('history.shown', { count: invoices.length })}
                  </p>
                  {next === null ? null : (
                    <Button
                      variant="secondary"
                      loading={loadingMore}
                      onClick={() => {
                        setLoadingMore(true);
                        api
                          .getBillHistory({ query: { ...query, cursor: next } })
                          .then(
                            (following) => {
                              setMore({
                                key,
                                invoices: [...(extra?.invoices ?? []), ...following.invoices],
                                next: following.nextCursor,
                              });
                            },
                            (failure: unknown) => {
                              toast.show({ title: messageOf(failure, t), tone: 'danger' });
                            },
                          )
                          .finally(() => {
                            setLoadingMore(false);
                          });
                      }}
                    >
                      {t('history.more')}
                    </Button>
                  )}
                </div>
              )}
            </>
          );
        }}
      </ReportBody>
      {opened === undefined ? null : (
        <OpenedBill
          opened={opened}
          onClose={() => {
            setOpened(undefined);
          }}
        />
      )}
    </ReportSection>
  );
}
