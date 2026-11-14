import type { PendingBill } from '@rp/contracts';
import { alertAge } from '@rp/ordering';
import { Badge, Button, ErrorState, LoadingState, Table } from '@rp/ui-web';
import { NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { useConsole, useConsoleState } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { messageOf } from '../app/messages.js';
import { grantOf } from '../app/modes.js';
import { useLive } from '../app/use-live.js';
import { useNow } from '../app/use-now.js';
import { BillHistory } from '../manage/reports/BillHistory.js';
import { RangedPage } from '../manage/reports/RangedPage.js';
import { moneyColumn, textColumn } from '../manage/reports/ReportParts.js';
import { BillScreen } from './BillScreen.js';
import { DayEndScreen } from './DayEndScreen.js';
import { PaymentScreen } from './PaymentScreen.js';
import { ShiftScreen } from './ShiftScreen.js';
import { useOpenBill } from './use-open-bill.js';

export const BILLS = '/manage/bills';

/** What changes the pending bills: asked for, printed, paid, more dishes, a table closed. */
export const affectsPendingBills = (eventType: string) =>
  /^(BillRequested|BillPrinted|BillSettled|TableStateChanged|TableClosed|TableMoved|OrdersMoved|OrderSubmitted|OrderApproved|AlertRaised)$/.test(
    eventType,
  );

/**
 * The pending bills, kept live, for the page and the count beside Bills (ADR-0030); nothing is
 * asked for while `enabled` is false (someone who does not take payment).
 */
export function usePendingBills(enabled = true) {
  const controller = useConsole();
  return useLive(
    async () => (enabled ? (await controller.api.listPendingBills()).bills : []),
    affectsPendingBills,
  );
}

/**
 * The dashboard's Bills page (ADR-0030): Pending, every bill still to print or to take payment
 * for, and History, the bills already printed; with the bill, payment and day-end screens the
 * POS had. Paths are relative to `/manage/bills`.
 */
export function BillsArea() {
  return (
    <Routes>
      <Route index element={<Tabbed page="pending" />} />
      <Route path="history" element={<Tabbed page="history" />} />
      <Route path="bill/:billId" element={<Bill />} />
      <Route path="pay/:invoiceId" element={<Pay />} />
      <Route path="day-end" element={<DayEnd />} />
    </Routes>
  );
}

function Tabbed({ page }: { page: 'pending' | 'history' }) {
  const t = useT();
  const navigate = useNavigate();
  const { person } = useConsoleState();
  const closesDay = person !== undefined && grantOf(person, 'DAY_END_CLOSE') !== 'DENY';
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-bills">
      <div className="pos-floor__bar">
        <h2 id="dashboard-bills" className="dashboard-section__heading">
          {t('bills.title')}
        </h2>
        {closesDay ? (
          <Button
            variant="secondary"
            onClick={() => {
              void navigate(`${BILLS}/day-end`);
            }}
          >
            {t('bills.dayEnd')}
          </Button>
        ) : null}
      </div>
      <nav aria-label={t('bills.tabs')} className="staff-pages">
        <NavLink to={BILLS} end className="staff-pages__link">
          {t('bills.pending')}
        </NavLink>
        <NavLink to={`${BILLS}/history`} className="staff-pages__link">
          {t('bills.history')}
        </NavLink>
      </nav>
      {page === 'pending' ? (
        <PendingBills />
      ) : (
        <RangedPage>{(range) => <BillHistory range={range} />}</RangedPage>
      )}
    </section>
  );
}

function PendingBills() {
  const t = useT();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const { data, reload } = usePendingBills();
  const { openBill, opening } = useOpenBill();
  if (data.status === 'loading') return <LoadingState title={t('states.loading')} />;
  if (data.status === 'error') {
    return (
      <ErrorState
        title={t('bills.loadFailed')}
        description={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  }
  const placeOf = (row: PendingBill) =>
    row.kind === 'TABLE'
      ? t('bills.table', { table: row.tableLabel ?? '' })
      : t('bills.takeaway', { token: row.takeawayToken ?? 0 });
  const open = (row: PendingBill) => {
    if (row.billId !== null) {
      void navigate(`${BILLS}/bill/${row.billId}`);
      return;
    }
    openBill(
      row.tableSessionId === null
        ? { orderId: row.orderId ?? '' }
        : { tableSessionId: row.tableSessionId },
    );
  };
  return (
    <>
      <p className="dashboard-section__hint">{t('bills.intro')}</p>
      <Table<PendingBill>
        caption={t('bills.list')}
        columns={[
          textColumn('place', t('bills.column.place'), placeOf),
          moneyColumn('amount', t('bills.column.amount'), (row) => row.amount),
          textColumn('waiting', t('bills.column.waiting'), (row) => alertAge(row.since, now, t)),
          textColumn('status', t('bills.column.status'), (row) => (
            <Badge tone={row.status === 'REQUESTED' ? 'warning' : 'info'}>
              {t(`bills.status.${row.status}`)}
            </Badge>
          )),
          textColumn('actions', t('bills.column.actions'), (row) => (
            <div className="bill__actions">
              {/* One printed bill to pay: straight to the payment; anything else, the bill. */}
              {row.status === 'PRINTED' && row.invoiceIds.length === 1 ? (
                <Button
                  onClick={() => {
                    void navigate(
                      `${BILLS}/pay/${row.invoiceIds[0] ?? ''}?bill=${row.billId ?? ''}`,
                    );
                  }}
                >
                  {t('bills.pay')}
                </Button>
              ) : null}
              <Button
                variant={
                  row.status === 'PRINTED' && row.invoiceIds.length === 1 ? 'secondary' : 'primary'
                }
                loading={opening}
                aria-label={`${t('bills.open')}: ${placeOf(row)}`}
                onClick={() => {
                  open(row);
                }}
              >
                {t('bills.open')}
              </Button>
            </div>
          )),
        ]}
        rows={data.value}
        rowKey={(row) => row.tableSessionId ?? row.orderId ?? ''}
        empty={t('bills.none')}
      />
    </>
  );
}

/**
 * Where a screen opened from another goes back to: `?back=`, when it is a Bills address (a bill
 * paid from day-end), else the pending bills (QA-030, QA-031).
 */
function backTo(search: URLSearchParams, fallback = BILLS): string {
  const back = search.get('back');
  return back?.startsWith('/manage/') === true ? back : fallback;
}

function Bill() {
  const { billId = '' } = useParams();
  const navigate = useNavigate();
  return (
    <BillScreen
      key={billId}
      billId={billId}
      onBack={() => {
        void navigate(BILLS);
      }}
      onPay={(invoiceId) => {
        void navigate(`${BILLS}/pay/${invoiceId}?bill=${billId}`);
      }}
    />
  );
}

function Pay() {
  const { invoiceId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const bill = search.get('bill');
  const back = () => {
    void navigate(backTo(search, bill === null ? BILLS : `${BILLS}/bill/${bill}`));
  };
  return <PaymentScreen key={invoiceId} invoiceId={invoiceId} onBack={back} onDone={back} />;
}

function DayEnd() {
  const navigate = useNavigate();
  return (
    <DayEndScreen
      onBack={() => {
        void navigate(BILLS);
      }}
      onPay={(invoiceId) => {
        void navigate(`${BILLS}/pay/${invoiceId}?back=${encodeURIComponent(`${BILLS}/day-end`)}`);
      }}
    />
  );
}

/** The cash drawer (an optional shift, ADR-0029) as a dashboard page; `?id=` is another's. */
export function CashDrawer() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  return (
    <ShiftScreen
      shiftId={search.get('id') ?? undefined}
      onBack={() => {
        void navigate(backTo(search));
      }}
    />
  );
}
