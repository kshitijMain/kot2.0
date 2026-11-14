import { affectsFloor } from '@rp/ordering';
import { Button } from '@rp/ui-web';
import { useNavigate } from 'react-router';
import { useConsole, useConsoleState } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { grantOf, modesFor } from '../app/modes.js';
import { useLive } from '../app/use-live.js';
import { useOpenBill } from '../billing/use-open-bill.js';

/**
 * What a manager can do about one table from the dashboard (QA-023): its bill, and the POS's table
 * actions (move, merge, free, clean). A table that asked for its bill can be billed from here even
 * when nothing is cooking and the alert is gone.
 */
export function TableActions({ tableId }: { tableId: string }) {
  const t = useT();
  const controller = useConsole();
  const { person } = useConsoleState();
  const navigate = useNavigate();
  const { openBill, opening } = useOpenBill();
  const { data } = useLive(() => controller.api.getTableOverview(), affectsFloor);
  const mayBill = person !== undefined && grantOf(person, 'BILL_PRINT_AND_PAYMENT') !== 'DENY';
  // Managers have no POS (ADR-0030): only someone who also works the POS gets its table actions.
  const mayUsePos = person !== undefined && modesFor(person).includes('pos');
  const table =
    data.status === 'ready'
      ? data.value.tables.find((entry) => entry.tableId === tableId)
      : undefined;
  const session = table?.session ?? null;
  return (
    <>
      {mayBill && session !== null ? (
        <Button
          loading={opening}
          onClick={() => {
            openBill({ tableSessionId: session.id });
          }}
        >
          {t('pos.billTable')}
        </Button>
      ) : null}
      {mayUsePos ? (
        <Button
          variant="secondary"
          onClick={() => {
            void navigate(`/pos?table=${encodeURIComponent(tableId)}`);
          }}
        >
          {t('dashboard.orders.tableActions')}
        </Button>
      ) : null}
    </>
  );
}
