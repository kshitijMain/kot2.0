import type { Capability } from '@rp/domain';
import { affectsApprovals } from '@rp/ordering';
import { Badge } from '@rp/ui-web';
import { useEffect, useRef } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { AlertCentre } from '../alerts/AlertCentre.js';
import { alertsForMe } from '../alerts/alert-view.js';
import { useAlerts } from '../alerts/alerts-context.js';
import { useConsole, useConsoleState } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { grantOf } from '../app/modes.js';
import { useLive } from '../app/use-live.js';
import { BillsArea, CashDrawer, usePendingBills } from '../billing/BillsArea.js';
import { Approvals } from '../pos/Approvals.js';
import { ControlReport } from './reports/ControlReports.js';
import { RangedPage } from './reports/RangedPage.js';
import { TablesScreen } from './tables/TablesScreen.js';
import { TakeOrderArea } from './take-order/TakeOrderArea.js';
import { AvailabilityScreen } from '../stock/AvailabilityScreen.js';
import { ScreenHelp } from '../help/ScreenHelp.js';
import { DevicesScreen } from './devices/DevicesScreen.js';
import { MenuFileScreen } from './menu/MenuFileScreen.js';
import { BulkPhotosScreen } from './menu/BulkPhotosScreen.js';
import { MenuEditor } from './menu/MenuEditor.js';
import { DashboardUnpublishedNotice } from './menu/UnpublishedNotice.js';
import { PrintingScreen } from './printing/PrintingScreen.js';
import { AuditScreen } from './audit/AuditScreen.js';
import { ReportsArea } from './reports/ReportsArea.js';
import { RestaurantScreen } from './restaurant/RestaurantScreen.js';
import { NotificationRulesScreen } from './settings/NotificationRulesScreen.js';
import { RecommendationsScreen } from './settings/RecommendationsScreen.js';
import { SettingsScreen } from './settings/SettingsScreen.js';
import { FloorScreen } from './floor/FloorScreen.js';
import { LicenceScreen } from './licence/LicenceScreen.js';
import { QrCodesScreen } from './qr/QrCodesScreen.js';
import { ReadinessChecklist } from './setup/ReadinessChecklist.js';
import { SetupScreen } from './setup/SetupScreen.js';
import { OrderFeedScreen } from './OrderFeedScreen.js';
import { Overview } from './Overview.js';
import { StaffArea } from './staff/StaffArea.js';
import { ArchiveViewerScreen } from './system/ArchiveViewerScreen.js';
import { SystemScreen } from './system/SystemScreen.js';

/** A dashboard link, with its live count when something waits (ADR-0030). */
function Section({
  to,
  end = false,
  label,
  count,
}: {
  to: string;
  end?: boolean;
  label: string;
  count?: number;
}) {
  const t = useT();
  const waiting = count !== undefined && count > 0;
  return (
    <NavLink
      to={to}
      end={end}
      className="dashboard__link"
      {...(waiting && { 'aria-label': `${label}, ${t('dashboard.badge', { count })}` })}
    >
      {label}
      {waiting ? (
        <Badge tone="warning" variant="solid" aria-hidden>
          {count}
        </Badge>
      ) : null}
    </NavLink>
  );
}

/** How many pending bills there are, kept live, or nothing until known. */
function useBillCount(enabled: boolean): number | undefined {
  const { data } = usePendingBills(enabled);
  return enabled && data.status === 'ready' ? data.value.length : undefined;
}

/** How many diners' orders wait for approval, kept live. */
function useApprovalCount(enabled: boolean): number | undefined {
  const controller = useConsole();
  const { data } = useLive(
    async () => (enabled ? (await controller.api.listPendingApprovals()).orders.length : 0),
    affectsApprovals,
  );
  return enabled && data.status === 'ready' ? data.value : undefined;
}

/** How many alerts are the signed-in person's, as the header's bell counts them. */
function useAlertCount(): number | undefined {
  const state = useAlerts();
  if (state?.alerts.status !== 'ready') return undefined;
  return alertsForMe(state.alerts.value, state.person.id).length;
}

/**
 * The manager dashboard (P4-01, MGR-001), where managers and the Owner do everything (ADR-0030):
 * Bills (pending and history, with the bill, payment and day-end screens the POS had),
 * Modifications (diners' orders to approve), Alerts, Take order (dine-in), the live Tables, the
 * menu and its availability, staff, reports, cancelled KOTs, the restaurant, set-up, devices, QR
 * codes and the optional cash drawer; then, under More, the overview, the live order feed, the
 * audit trail, the floor, kitchen and printers, settings, the System page and the licence. Each
 * page shows for the people who may use it (BRD §4.2, AUTH-012); the server refuses the rest
 * anyway. The navigation sits beside the page on a wide screen and above it on a phone
 * (MGR-011); the page shown is marked for screen readers, not by colour alone.
 */
export function ManageHome() {
  const t = useT();
  const { person } = useConsoleState();
  const allows = (capability: Capability) =>
    person !== undefined && grantOf(person, capability) === 'ALLOW';
  // The overview, order feed and alerts are the managers' view of service (OPERATIONS_CONFIGURE);
  // a custom role that only adds, say, the menu opens straight on its own page (AUTH-012).
  const operates = allows('OPERATIONS_CONFIGURE');
  const bills = person !== undefined && grantOf(person, 'BILL_PRINT_AND_PAYMENT') !== 'DENY';
  const takesOrders = operates && allows('ORDER_CREATE');
  const managesStaff = allows('STAFF_MANAGE');
  const pairsDevices = allows('DEVICE_PAIR');
  const managesMenu = allows('MENU_MANAGE');
  // ADR-0023: out of stock and back, for whoever manages stock.
  const managesStock = allows('STOCK_MANAGE');
  const seesReports = allows('REPORTS_VIEW_EXPORT');
  const viewsAudit = allows('AUDIT_VIEW');
  const viewsLicence = person !== undefined && grantOf(person, 'LICENSE_VIEW') !== 'DENY';
  const managesLicence = person !== undefined && grantOf(person, 'LICENSE_MANAGE') !== 'DENY';
  const billCount = useBillCount(bills);
  const approvalCount = useApprovalCount(operates);
  const alertCount = useAlertCount();
  // On a phone the sections are one row that scrolls sideways: keep the open one in view.
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const open = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (open !== null && open !== undefined && typeof open.scrollIntoView === 'function') {
      open.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [pathname]);
  // The first page each person has: bills for whoever takes payment, else their own page.
  const first = bills
    ? 'bills'
    : operates
      ? 'overview'
      : seesReports
        ? 'reports'
        : managesMenu
          ? 'menu'
          : managesStaff
            ? 'staff'
            : pairsDevices
              ? 'devices'
              : undefined;
  const more = operates || viewsAudit || managesStaff || viewsLicence;
  return (
    <div className="dashboard">
      <nav aria-label={t('dashboard.navigation')} className="dashboard__nav" ref={navRef}>
        {bills ? (
          <Section to="/manage/bills" label={t('dashboard.section.bills')} count={billCount} />
        ) : null}
        {operates ? (
          <>
            <Section
              to="/manage/modifications"
              label={t('dashboard.section.modifications')}
              count={approvalCount}
            />
            <Section to="/manage/alerts" label={t('dashboard.section.alerts')} count={alertCount} />
          </>
        ) : null}
        {takesOrders ? (
          <Section to="/manage/take-order" label={t('dashboard.section.takeOrder')} />
        ) : null}
        {operates || bills ? (
          <Section to="/manage/tables" label={t('dashboard.section.tables')} />
        ) : null}
        {managesMenu ? <Section to="/manage/menu" label={t('dashboard.section.menu')} /> : null}
        {managesStock ? (
          <Section to="/manage/availability" label={t('dashboard.section.availability')} />
        ) : null}
        {managesStaff ? <Section to="/manage/staff" label={t('dashboard.section.staff')} /> : null}
        {seesReports ? (
          <>
            <Section to="/manage/reports" label={t('dashboard.section.reports')} />
            <Section to="/manage/cancelled-kots" label={t('dashboard.section.cancelledKots')} />
          </>
        ) : null}
        {operates ? (
          <>
            <Section to="/manage/restaurant" label={t('dashboard.section.restaurant')} />
            <Section to="/manage/setup" label={t('dashboard.section.setup')} />
          </>
        ) : null}
        {pairsDevices ? (
          <Section to="/manage/devices" label={t('dashboard.section.devices')} />
        ) : null}
        {managesStaff ? (
          <Section to="/manage/qr-codes" label={t('dashboard.section.qrCodes')} />
        ) : null}
        {bills ? (
          <Section to="/manage/cash-drawer" label={t('dashboard.section.cashDrawer')} />
        ) : null}
        {more ? <span className="dashboard__more">{t('dashboard.more')}</span> : null}
        {operates ? (
          <>
            <Section to="/manage/overview" label={t('dashboard.section.overview')} />
            <Section to="/manage/orders" label={t('dashboard.section.orders')} />
          </>
        ) : null}
        {viewsAudit ? <Section to="/manage/audit" label={t('dashboard.section.audit')} /> : null}
        {managesStaff ? <Section to="/manage/floor" label={t('dashboard.section.floor')} /> : null}
        {operates ? (
          <>
            <Section to="/manage/printing" label={t('dashboard.section.printing')} />
            <Section to="/manage/settings" label={t('dashboard.section.settings')} />
            <Section to="/manage/system" label={t('dashboard.section.system')} />
          </>
        ) : null}
        {viewsLicence ? (
          <Section to="/manage/licence" label={t('dashboard.section.licence')} />
        ) : null}
      </nav>
      <div className="dashboard__content">
        <ScreenHelp />
        {managesMenu ? <DashboardUnpublishedNotice /> : null}
        <Routes>
          {first === undefined ? null : (
            <Route index element={<Navigate to={`/manage/${first}`} replace />} />
          )}
          {bills ? <Route path="bills/*" element={<BillsArea />} /> : null}
          {bills ? <Route path="cash-drawer" element={<CashDrawer />} /> : null}
          {operates || bills ? <Route path="tables" element={<TablesScreen />} /> : null}
          {operates ? (
            <>
              <Route path="overview" element={<Overview />} />
              <Route path="orders" element={<OrderFeedScreen />} />
              <Route path="alerts" element={<AlertsSection />} />
              <Route path="modifications" element={<ModificationsSection />} />
            </>
          ) : null}
          {takesOrders ? <Route path="take-order/*" element={<TakeOrderArea />} /> : null}
          {seesReports ? <Route path="reports/*" element={<ReportsArea />} /> : null}
          {seesReports ? <Route path="cancelled-kots" element={<CancelledKots />} /> : null}
          {seesReports ? <Route path="archives/:id" element={<ArchiveViewerScreen />} /> : null}
          {viewsAudit ? <Route path="audit" element={<AuditScreen />} /> : null}
          {managesStaff ? <Route path="staff/*" element={<StaffArea />} /> : null}
          {managesStaff ? <Route path="floor" element={<FloorScreen />} /> : null}
          {managesStaff ? <Route path="qr-codes" element={<QrCodesScreen />} /> : null}
          {managesMenu ? <Route path="menu" element={<MenuEditor />} /> : null}
          {managesMenu ? <Route path="menu/import" element={<MenuFileScreen />} /> : null}
          {managesMenu ? <Route path="menu/photos" element={<BulkPhotosScreen />} /> : null}
          {managesStock ? <Route path="availability" element={<AvailabilityScreen />} /> : null}
          {pairsDevices ? <Route path="devices" element={<DevicesScreen />} /> : null}
          {operates ? <Route path="setup" element={<SetupScreen />} /> : null}
          {operates ? <Route path="setup/readiness" element={<ReadinessChecklist />} /> : null}
          {operates ? <Route path="restaurant" element={<RestaurantScreen />} /> : null}
          {operates ? <Route path="printing" element={<PrintingScreen />} /> : null}
          {operates ? <Route path="settings" element={<SettingsScreen />} /> : null}
          {operates ? <Route path="system" element={<SystemScreen />} /> : null}
          {operates ? (
            <Route path="settings/notifications" element={<NotificationRulesScreen />} />
          ) : null}
          {operates ? (
            <Route path="settings/recommendations" element={<RecommendationsScreen />} />
          ) : null}
          {viewsLicence ? (
            <Route path="licence" element={<LicenceScreen owner={managesLicence} />} />
          ) : null}
          <Route path="*" element={<Navigate to="/manage" replace />} />
        </Routes>
      </div>
    </div>
  );
}

/** Diners' orders waiting for approval (ORD-004, WTR-004) as a dashboard page (ADR-0030). */
function ModificationsSection() {
  const t = useT();
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-modifications">
      <h2 id="dashboard-modifications" className="dashboard-section__heading">
        {t('modifications.title')}
      </h2>
      <p className="dashboard-section__hint">{t('modifications.intro')}</p>
      <Approvals empty={t('modifications.none')} />
    </section>
  );
}

/** The cancellation report (RPT-008) as its own page, today by default (ADR-0030). */
function CancelledKots() {
  const t = useT();
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-cancelled">
      <h2 id="dashboard-cancelled" className="dashboard-section__heading">
        {t('cancelledKots.title')}
      </h2>
      <RangedPage>{(range) => <ControlReport slug="cancellations" range={range} />}</RangedPage>
    </section>
  );
}

/** The alert centre (P2-06c, MGR-008) as a dashboard page. */
function AlertsSection() {
  const t = useT();
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-alerts">
      <h2 id="dashboard-alerts" className="dashboard-section__heading">
        {t('alerts.title')}
      </h2>
      <AlertCentre />
    </section>
  );
}
