import type { TableOverviewEntry } from '@rp/contracts';
import { floorSections, tileAlert, tileDetails } from '@rp/ordering';
import { EmptyState, ErrorState, LoadingState, TableTile, useToast } from '@rp/ui-web';
import { useState } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useNow } from '../../app/use-now.js';
import { OpenTableDialog } from '../../pos/OpenTableDialog.js';
import { OrderEntry } from '../../pos/OrderEntry.js';
import { useFloor } from '../../pos/use-floor.js';

const TAKE_ORDER = '/manage/take-order';

const orderPath = (sessionId: string, label: string) =>
  `${TAKE_ORDER}/table/${sessionId}?label=${encodeURIComponent(label)}`;

/**
 * The dashboard's Take order (ADR-0030): dine-in only, takeaway being the waiters'. Pick a
 * table; a free one is opened for its guests first (with the capacity warning, item D); then the
 * POS's order screen adds dishes with their sizes, add-ons and notes and sends the KOT.
 */
export function TakeOrderArea() {
  return (
    <Routes>
      <Route index element={<TablePicker />} />
      <Route path="table/:sessionId" element={<TableOrder />} />
    </Routes>
  );
}

function TablePicker() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const { data, reload } = useFloor();
  const [opening, setOpening] = useState<TableOverviewEntry | undefined>();
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
  const sections = floorSections(data.value.floor, data.value.overview);
  const select = (table: TableOverviewEntry) => {
    if (table.session !== null) {
      void navigate(orderPath(table.session.id, table.label));
    } else if (table.state === 'FREE') {
      setOpening(table);
    } else {
      toast.show({ title: t('takeOrder.notReady', { table: table.label }), tone: 'warning' });
    }
  };
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-take-order">
      <h2 id="dashboard-take-order" className="dashboard-section__heading">
        {t('takeOrder.title')}
      </h2>
      <p className="dashboard-section__hint">{t('takeOrder.intro')}</p>
      {sections.every((section) => section.tables.length === 0) ? (
        <EmptyState title={t('pos.noTables')} />
      ) : null}
      {sections.map((section) => (
        <section
          key={section.id}
          className="pos-floor__section"
          aria-label={section.name === '' ? t('pos.tables') : section.name}
        >
          {section.name === '' ? null : <h3 className="pos-floor__heading">{section.name}</h3>}
          <div className="pos-floor__tables">
            {section.tables.map((table) => (
              <TableTile
                key={table.tableId}
                label={table.label}
                state={table.state}
                stateLabel={t(`pos.tableState.${table.state}`)}
                details={tileDetails(table, now, t)}
                {...(table.session !== null && { amountSoFar: table.session.amountSoFar })}
                {...(tileAlert(table, t) !== undefined && { alert: tileAlert(table, t) })}
                onSelect={() => {
                  select(table);
                }}
              />
            ))}
          </div>
        </section>
      ))}
      {opening === undefined ? null : (
        <OpenTableDialog
          table={opening}
          onClose={() => {
            setOpening(undefined);
          }}
          onOpened={(sessionId) => {
            setOpening(undefined);
            void navigate(orderPath(sessionId, opening.label));
          }}
        />
      )}
    </section>
  );
}

function TableOrder() {
  const { sessionId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  return (
    <OrderEntry
      key={sessionId}
      target={{ kind: 'table', sessionId, label: search.get('label') ?? '' }}
      onBack={() => {
        void navigate(TAKE_ORDER);
      }}
    />
  );
}
