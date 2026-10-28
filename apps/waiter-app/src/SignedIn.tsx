import type { AlertTableOpener } from '@rp/mobile-native';
import { useDeviceSession, useT } from '@rp/mobile-shell';
import { useToast } from '@rp/ui-native';
import { useCallback, useEffect, useState } from 'react';
import { CartsProvider } from './carts';
import { TableScreen } from './TableScreen';
import { TablesScreen } from './TablesScreen';
import { TakeawayScreen } from './TakeawayScreen';

type Place =
  | { readonly screen: 'tables' }
  | { readonly screen: 'table'; readonly sessionId: string }
  | { readonly screen: 'takeaway' };

/** Says so when an order kept on the phone reaches the kitchen later, wherever the waiter is. */
function useOrdersSentLater() {
  const session = useDeviceSession();
  const toast = useToast();
  const t = useT();
  useEffect(
    () =>
      session.orders.onSent(({ draft, order, background }) => {
        if (!background) return;
        toast.show({
          title: t('mobile.order.sentLater', {
            number: order.orderNumber,
            table: draft.tableLabel,
          }),
          tone: 'success',
        });
      }),
    [session, toast, t],
  );
}

/**
 * The signed-in waiter app: the tables, and one table's orders (WTR-002, WTR-003). A tapped alert
 * notification opens its table (`opener`), as does an alert in the bell's list. The phone's back
 * button goes back a screen: from a table or the takeaway screen to the tables (each screen
 * handles it); on the tables Android leaves the app, which keeps alerting.
 */
export function SignedIn({ opener }: { opener?: AlertTableOpener }) {
  const [place, setPlace] = useState<Place>({ screen: 'tables' });
  const openTable = useCallback((sessionId: string) => {
    setPlace({ screen: 'table', sessionId });
  }, []);
  useEffect(() => {
    if (opener === undefined) return undefined;
    let live = true;
    // The tap that started the app, then those while it runs.
    opener
      .takeOpenedTable()
      .then((sessionId) => {
        if (live && sessionId !== null) openTable(sessionId);
      })
      .catch(() => undefined);
    const stop = opener.onOpenTable(openTable);
    return () => {
      live = false;
      stop();
    };
  }, [opener, openTable]);
  const back = useCallback(() => {
    setPlace({ screen: 'tables' });
  }, []);
  const takeaway = useCallback(() => {
    setPlace({ screen: 'takeaway' });
  }, []);
  useOrdersSentLater();
  return (
    <CartsProvider>
      {place.screen === 'tables' ? (
        <TablesScreen onOpenTable={openTable} onTakeaway={takeaway} />
      ) : place.screen === 'takeaway' ? (
        <TakeawayScreen onBack={back} onOpenTable={openTable} />
      ) : (
        <TableScreen
          key={place.sessionId}
          sessionId={place.sessionId}
          onBack={back}
          onOpenTable={openTable}
        />
      )}
    </CartsProvider>
  );
}
