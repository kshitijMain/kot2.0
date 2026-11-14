import { useT } from '@rp/mobile-shell';
import { Button, Sheet } from '@rp/ui-native';
import { BreakCard, type BreakState } from './BreakCard';
import { PagerCard } from './PagerCard';

/**
 * What the waiter needs now and then, behind the home screen's Menu so the tables come first:
 * their pager (WTR-014) and their break (NTF-009). Who is signed in and Sign out are on the home
 * screen itself (ADR-0030).
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
  return (
    <Sheet open title={t('mobile.tables.menu')} onClose={onClose}>
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
    </Sheet>
  );
}
