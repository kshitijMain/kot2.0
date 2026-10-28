import { Note, useDeviceSession, useSessionState, useT } from '@rp/mobile-shell';
import { Button, Sheet } from '@rp/ui-native';
import { BreakCard, type BreakState } from './BreakCard';
import { PagerCard } from './PagerCard';

/**
 * What the waiter needs now and then, behind the home screen's Menu so the tables come first:
 * who is signed in, their pager (WTR-014), their break (NTF-009), a takeaway order (WTR-013) and
 * signing out.
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
  const session = useDeviceSession();
  const { person } = useSessionState();
  const t = useT();
  return (
    <Sheet open title={t('mobile.tables.menu')} onClose={onClose}>
      {person === undefined ? null : (
        <Note>{t('mobile.signedInAs', { name: person.displayName })}</Note>
      )}
      <PagerCard />
      <BreakCard state={breakState} />
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
      <Button
        variant="ghost"
        fullWidth
        testID="sign-out"
        onPress={() => {
          onClose();
          void session.signOut();
        }}
      >
        {t('login.signOut')}
      </Button>
    </Sheet>
  );
}
