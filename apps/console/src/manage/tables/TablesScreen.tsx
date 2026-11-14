import type { TableOverviewEntry } from '@rp/contracts';
import { floorSections, seatedFor } from '@rp/ordering';
import { Badge, Button, ErrorState, LoadingState, Table } from '@rp/ui-web';
import { useConsoleState } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { grantOf } from '../../app/modes.js';
import { useNow } from '../../app/use-now.js';
import { useOpenBill } from '../../billing/use-open-bill.js';
import { useFloor } from '../../pos/use-floor.js';
import { moneyColumn, textColumn } from '../reports/ReportParts.js';

type OpenTable = TableOverviewEntry & {
  readonly session: NonNullable<TableOverviewEntry['session']>;
};

/**
 * The dashboard's Tables (ADR-0030): which tables are open, with their guests, how long they have
 * been seated, who opened them and the amount so far, kept live. Read-only: the one thing to do
 * from here is open a table's bill; orders are taken from Take order and the waiters' phones.
 */
export function TablesScreen() {
  const t = useT();
  const { person } = useConsoleState();
  const now = useNow(30_000);
  const { data, reload } = useFloor();
  const { openBill, opening } = useOpenBill();
  const mayBill = person !== undefined && grantOf(person, 'BILL_PRINT_AND_PAYMENT') !== 'DENY';
  if (data.status === 'loading') return <LoadingState title={t('states.loading')} />;
  if (data.status === 'error') {
    return (
      <ErrorState
        title={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  }
  const tables = floorSections(data.value.floor, data.value.overview).flatMap(
    (section) => section.tables,
  );
  const open = tables.filter((table): table is OpenTable => table.session !== null);
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-tables">
      <h2 id="dashboard-tables" className="dashboard-section__heading">
        {t('tablesPage.title')}
      </h2>
      <p className="dashboard-section__hint">
        {t('tablesPage.summary', { open: open.length, total: tables.length })}
      </p>
      <Table<OpenTable>
        caption={t('tablesPage.list')}
        columns={[
          textColumn('table', t('tablesPage.column.table'), (row) => row.label),
          textColumn('guests', t('tablesPage.column.guests'), (row) => String(row.session.covers)),
          textColumn('seated', t('tablesPage.column.seated'), (row) =>
            seatedFor(row.session.openedAt, now, t),
          ),
          textColumn('openedBy', t('tablesPage.column.openedBy'), (row) => row.session.waiterName),
          moneyColumn('amount', t('tablesPage.column.amount'), (row) => row.session.amountSoFar),
          textColumn('state', t('tablesPage.column.state'), (row) => (
            <Badge tone={row.state === 'OCCUPIED' ? 'neutral' : 'warning'}>
              {t(`pos.tableState.${row.state}`)}
            </Badge>
          )),
          ...(mayBill
            ? [
                textColumn<OpenTable>('actions', t('tablesPage.column.actions'), (row) => (
                  <Button
                    variant="secondary"
                    loading={opening}
                    aria-label={t('tablesPage.openBillFor', { table: row.label })}
                    onClick={() => {
                      openBill({ tableSessionId: row.session.id });
                    }}
                  >
                    {t('tablesPage.openBill')}
                  </Button>
                )),
              ]
            : []),
        ]}
        rows={open}
        rowKey={(row) => row.tableId}
        empty={t('tablesPage.none')}
      />
    </section>
  );
}
