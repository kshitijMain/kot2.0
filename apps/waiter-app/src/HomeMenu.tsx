import { Note, useSessionState, useT } from '@rp/mobile-shell';
import { Button, Sheet } from '@rp/ui-native';
import { Platform } from 'react-native';
import { BreakCard, type BreakState } from './BreakCard';
import { PagerCard } from './PagerCard';

/** Whether the phone web app runs from the Home Screen (iPhone: `standalone`; others: the media). */
function fromHomeScreen(): boolean {
  const browser = globalThis as {
    navigator?: { standalone?: boolean };
    matchMedia?: (query: string) => { matches: boolean };
  };
  if (browser.navigator?.standalone === true) return true;
  return browser.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

/** An iPhone or iPad, whose browsers add to the Home Screen from Share; others from ⋮. */
function onAnIphone(): boolean {
  const agent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';
  return /iPhone|iPad|iPod/.test(agent);
}

/**
 * What the waiter needs now and then, behind the home screen's Menu so the tables come first:
 * their pager (WTR-014), their break (NTF-009) and a takeaway order (WTR-013). In the phone web
 * app (P9-28) also how its alerts work, and for managers and the Owner the full dashboard (the
 * console) in a new tab. Who is signed in and Sign out are on the home screen itself (ADR-0030).
 */
export function HomeMenu({
  breakState,
  onTakeaway,
  onClose,
}: {
  breakState: BreakState;
  onTakeaway?: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { person } = useSessionState();
  const inBrowser = Platform.OS === 'web';
  const runsTheRestaurant = person?.role === 'MANAGER' || person?.role === 'OWNER';
  return (
    <Sheet open title={t('mobile.tables.menu')} onClose={onClose}>
      {onTakeaway === undefined ? null : (
        <Button
          variant="secondary"
          fullWidth
          testID="new-takeaway"
          onPress={() => {
            onClose();
            onTakeaway();
          }}
        >
          {t('mobile.takeaway.new')}
        </Button>
      )}
      {/* The Owner takes no break the manager covers (P9-28: the Owner on a phone). */}
      {person?.role === 'OWNER' ? null : <BreakCard state={breakState} />}
      <PagerCard />
      {inBrowser && runsTheRestaurant ? (
        <>
          <Button
            variant="secondary"
            fullWidth
            testID="open-dashboard"
            onPress={() => {
              onClose();
              globalThis.open('/', '_blank', 'noopener');
            }}
          >
            {t('mobile.tables.dashboard')}
          </Button>
          <Note>{t('mobile.tables.dashboardHint')}</Note>
        </>
      ) : null}
      {inBrowser ? <Note testID="web-alerts">{t('mobile.web.alerts')}</Note> : null}
      {inBrowser && !fromHomeScreen() ? (
        <Note testID="web-home-screen">
          {t(onAnIphone() ? 'mobile.web.homeScreen' : 'mobile.web.homeScreenAndroid')}
        </Note>
      ) : null}
    </Sheet>
  );
}
