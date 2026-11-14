import { MAX_COVERS, type TableOverviewEntry } from '@rp/contracts';
import { coversWarning } from '@rp/ordering';
import { Button, Dialog, TextField, useToast } from '@rp/ui-web';
import { useId, useState } from 'react';
import { useConsole } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { messageOf } from '../app/messages.js';

/** The party sizes a tap opens the table with; anything bigger is typed (P9-26). */
const QUICK_GUESTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Seat guests at a free table (TBL-003): one tap on the number of guests opens it (P9-26: it took
 * a field and a keypad before); a bigger party is typed. More guests than the table seats asks
 * first (ADR-0030). Any waiter serves any table, so none is chosen; the server records who opened
 * it (ADR-0023).
 */
export function OpenTableDialog({
  table,
  onClose,
  onOpened,
}: {
  table: TableOverviewEntry;
  onClose: () => void;
  /** The new sitting: the POS goes on to take its order (P9-20). */
  onOpened: (sessionId: string) => void;
}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const [guests, setGuests] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [working, setWorking] = useState(false);
  /** Guests chosen over the table's seats, waiting for "Yes, open it" (ADR-0030). */
  const [asking, setAsking] = useState<number | undefined>();
  const formId = useId();

  const submit = async (count?: number, confirmed = false) => {
    const covers = count ?? Number(guests);
    if (!Number.isInteger(covers) || covers < 1 || covers > MAX_COVERS) {
      setError(t('pos.open.invalidGuests'));
      return;
    }
    if (!confirmed && coversWarning(table, covers, t) !== undefined) {
      setError(undefined);
      setAsking(covers);
      return;
    }
    setAsking(undefined);
    setWorking(true);
    setError(undefined);
    try {
      const opened = await controller.api.openTable({
        params: { tableId: table.tableId },
        body: { covers },
      });
      toast.show({ title: t('pos.open.opened', { table: table.label }), tone: 'success' });
      onOpened(opened.id);
    } catch (failure) {
      setError(messageOf(failure, t));
      setWorking(false);
    }
  };

  if (asking !== undefined) {
    return (
      <Dialog
        open
        onClose={onClose}
        dismissible={!working}
        title={t('pos.open.title', { table: table.label })}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(undefined);
                setGuests('');
              }}
            >
              {t('pos.open.change')}
            </Button>
            <Button
              loading={working}
              onClick={() => {
                void submit(asking, true);
              }}
            >
              {t('pos.open.anyway')}
            </Button>
          </>
        }
      >
        <p className="console-notice console-notice--warning">{coversWarning(table, asking, t)}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!working}
      title={t('pos.open.title', { table: table.label })}
      footer={
        <Button type="submit" form={formId} variant="secondary" loading={working && guests !== ''}>
          {t('pos.open.submit')}
        </Button>
      }
    >
      <div
        className="guest-picker"
        role="group"
        aria-label={t('pos.open.howMany')}
        aria-describedby={error === undefined ? undefined : `${formId}-error`}
      >
        {QUICK_GUESTS.map((count) => (
          <button
            key={count}
            type="button"
            className="guest-picker__option"
            disabled={working}
            data-autofocus={count === 2 || undefined}
            aria-label={t('pos.open.guestsCount', { count })}
            onClick={() => {
              setGuests(String(count));
              void submit(count);
            }}
          >
            {count}
          </button>
        ))}
      </div>
      <form
        id={formId}
        className="console-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label={t('pos.open.more')}
          inputMode="numeric"
          value={guests}
          onChange={(event) => {
            setGuests(event.target.value.replace(/\D/g, '').slice(0, 2));
          }}
          error={error}
        />
      </form>
    </Dialog>
  );
}
