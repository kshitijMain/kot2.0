import type { ServiceRequestView, TableOverviewEntry } from '@rp/contracts';
import { fontSize, fontWeight, spacing } from '@rp/design-tokens';
import {
  AlertBell,
  messageOf,
  Note,
  Screen,
  useDeviceSession,
  useLive,
  useNow,
  useSessionState,
  useT,
} from '@rp/mobile-shell';
import { affectsFloor, floorSections, myTableIds, tileAlert, tileDetails } from '@rp/ordering';
import {
  Button,
  Glyph,
  SegmentedControl,
  TableTile,
  Text,
  useTheme,
  useToast,
  weight,
} from '@rp/ui-native';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NotificationsOff } from './notifications';
import { OpenTableSheet } from './OpenTableSheet';
import { BreakCard, useBreak } from './BreakCard';
import { HomeMenu } from './HomeMenu';
import { PagerCard } from './PagerCard';
import { Approvals } from './Approvals';
import { ServiceRequests } from './ServiceRequests';
import { UnsentHome } from './UnsentOrders';

type TablesView = 'mine' | 'all';

/** Seated times on the tiles move on every half minute. */
const CLOCK_MS = 30_000;

/**
 * The waiter app's home (WTR-002): "My tables" (the waiter's sections and tables for today, and
 * any table they are responsible for) or all tables, grouped by section two to a row, each with
 * its state, guests, time seated, waiter and anything waiting for staff. Above them only what
 * asks for the waiter: orders on this phone not yet sent (WTR-012), orders to approve, the
 * requests from the tables shown (WTR-005), and the pager or the break when something is up
 * (WTR-014, NTF-009). The header has the alerts' bell and the Menu (pager, break, takeaway,
 * signing out). A tap opens an open table, or opens a free one with its guests first. Read again
 * after table, order, bill and service-request events.
 */
export function TablesScreen({
  onOpenTable,
  onTakeaway,
}: {
  onOpenTable: (sessionId: string) => void;
  /** WTR-013: a takeaway order from the phone. */
  onTakeaway?: () => void;
}) {
  const session = useDeviceSession();
  const { person } = useSessionState();
  const t = useT();
  const { colors } = useTheme();
  const toast = useToast();
  const now = useNow(CLOCK_MS);
  const [view, setView] = useState<TablesView>(person?.role === 'WAITER' ? 'mine' : 'all');
  const [openingId, setOpeningId] = useState<string | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const breakState = useBreak();
  const { data, reload } = useLive(async () => {
    const [overview, assignments, floor] = await Promise.all([
      session.api.getTableOverview(),
      session.api.getWaiterAssignments(),
      session.api.getFloor(),
    ]);
    return { overview, assignments: assignments.current.assignments, floor };
  }, affectsFloor);

  const mine = useMemo(() => {
    if (data.status !== 'ready' || person === undefined) return undefined;
    return myTableIds(person.id, data.value.overview, data.value.assignments);
  }, [data, person]);
  const shown = useMemo(() => {
    if (data.status !== 'ready') return undefined;
    const sections = floorSections(data.value.floor, data.value.overview);
    if (view === 'all') return sections;
    if (mine === undefined) return undefined;
    return sections
      .map((section) => ({
        ...section,
        tables: section.tables.filter((table) => mine.has(table.tableId)),
      }))
      .filter((section) => section.tables.length > 0);
  }, [data, mine, view]);
  // The requests from the tables shown (WTR-005): the waiter's own, or every table's.
  const showRequest = useCallback(
    (request: ServiceRequestView) => view === 'all' || mine?.has(request.tableId) === true,
    [mine, view],
  );

  if (person === undefined) return null;
  const noneMine =
    view === 'mine' &&
    shown?.length === 0 &&
    data.status === 'ready' &&
    data.value.overview.tables.length > 0;
  const opening: TableOverviewEntry | undefined =
    data.status === 'ready' && openingId !== undefined
      ? data.value.overview.tables.find((table) => table.tableId === openingId)
      : undefined;

  return (
    <Screen
      title={t('mobile.tables.title')}
      actions={
        <View style={styles.headerActions}>
          <AlertBell onOpenTable={onOpenTable} />
          <Button
            variant="ghost"
            startIcon={<Glyph name="menu" color={colors.text} />}
            accessibilityLabel={t('mobile.tables.menuLabel')}
            testID="home-menu"
            onPress={() => {
              setMenuOpen(true);
            }}
          >
            {t('mobile.tables.menu')}
          </Button>
        </View>
      }
    >
      <NotificationsOff />
      <BreakCard state={breakState} onlyOnBreak />
      <PagerCard onlyWarnings />
      <UnsentHome onOpen={onOpenTable} />
      <Approvals />
      <ServiceRequests show={showRequest} />
      <SegmentedControl
        label={t('mobile.tables.view')}
        options={[
          { id: 'mine', label: t('mobile.tables.mine') },
          { id: 'all', label: t('mobile.tables.all') },
        ]}
        value={view}
        onChange={(next) => {
          setView(next === 'all' ? 'all' : 'mine');
        }}
      />
      {data.status === 'loading' && <Note>{t('states.loading')}</Note>}
      {data.status === 'error' && (
        <>
          <Note tone="danger">{messageOf(data.error, t)}</Note>
          <Button variant="secondary" onPress={reload}>
            {t('states.retry')}
          </Button>
        </>
      )}
      {data.status === 'ready' && data.value.overview.tables.length === 0 && (
        <Note>{t('mobile.tables.empty')}</Note>
      )}
      {noneMine && <Note>{t('mobile.tables.noneMine')}</Note>}
      {shown?.map((section) => (
        <View key={section.id} style={styles.section}>
          {section.name === '' ? null : (
            <Text accessibilityRole="header" style={[styles.sectionName, { color: colors.text }]}>
              {section.name}
            </Text>
          )}
          <View style={styles.grid}>
            {section.tables.map((table) => {
              const alert = tileAlert(table, t);
              return (
                <View key={table.tableId} style={styles.cell}>
                  <TableTile
                    label={table.label}
                    state={table.state}
                    stateLabel={t(`pos.tableState.${table.state}`)}
                    details={tileDetails(table, now, t)}
                    {...(alert !== undefined && { alert })}
                    testID={`table-${table.tableId}`}
                    onPress={() => {
                      if (table.session === null) setOpeningId(table.tableId);
                      else onOpenTable(table.session.id);
                    }}
                  />
                </View>
              );
            })}
          </View>
        </View>
      ))}
      {menuOpen ? (
        <HomeMenu
          breakState={breakState}
          {...(onTakeaway !== undefined && { onTakeaway })}
          onClose={() => {
            setMenuOpen(false);
          }}
        />
      ) : null}
      {opening === undefined ? null : (
        <OpenTableSheet
          key={opening.tableId}
          table={opening}
          onClose={() => {
            setOpeningId(undefined);
          }}
          onOpened={(opened) => {
            setOpeningId(undefined);
            toast.show({ title: t('pos.open.opened', { table: opening.label }), tone: 'success' });
            onOpenTable(opened.id);
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  section: { gap: spacing[2] },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing[2],
  },
  cell: { width: '48.5%' },
  sectionName: { fontSize: fontSize.lg, fontWeight: weight(fontWeight.semibold) },
});
