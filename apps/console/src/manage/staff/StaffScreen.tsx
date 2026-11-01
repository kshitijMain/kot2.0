import type { StaffView } from '@rp/contracts';
import { displayPhone, timeOfDayOf } from '@rp/domain';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  useToast,
} from '@rp/ui-web';
import { type ReactNode, useCallback, useState } from 'react';
import { useConsole, useConsoleState } from '../../app/console-context.js';
import { useT } from '../../app/i18n.js';
import { messageOf } from '../../app/messages.js';
import { useLive } from '../../app/use-live.js';
import { useNow } from '../../app/use-now.js';
import { ReasonDialog } from '../../billing/ReasonDialog.js';
import { PersonDialog, PinDialog } from './StaffDialogs.js';
import {
  groupOf,
  initialsOf,
  isLocked,
  lastSeenOf,
  type StaffAction,
  type StaffActorView,
  type StaffGroup,
  staffActions,
} from './staff-view.js';

/** Check locks again this often, so an expired lock stops showing without a reload. */
const CLOCK_MS = 30_000;

type Open =
  | { readonly kind: 'ADD' }
  | { readonly kind: 'EDIT' | 'SET_PIN' | 'DEACTIVATE' | 'REACTIVATE'; readonly person: StaffView };

/**
 * The Staff page (P4-02a, MGR-004): everyone who signs in here, active people first, with their
 * role, contact, PIN and lock state; adding people, editing them, setting PINs, unlocking,
 * deactivating and reactivating. Each person shows only the actions the signed-in person may take
 * (`@rp/domain` staff rules, checked again by the server), and the list follows every change made
 * on any screen (`RestaurantChanged`).
 */
export function StaffScreen() {
  const t = useT();
  const controller = useConsole();
  const { person: me } = useConsoleState();
  const toast = useToast();
  const now = useNow(CLOCK_MS);
  const { data, reload } = useLive(
    async () => {
      const [list, roles] = await Promise.all([
        controller.api.listStaff(),
        controller.api.listRoles(),
      ]);
      return { ...list, roles: roles.roles };
    },
    (type) => type === 'RestaurantChanged',
  );
  const [open, setOpen] = useState<Open | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const close = useCallback(() => {
    setOpen(undefined);
    setBusy(false);
    setError(undefined);
  }, []);

  /** A change went through: say so, read the list again and close the dialog. */
  const done = (message: string) => {
    toast.show({ title: message, tone: 'success' });
    close();
    reload();
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      done(message);
    } catch (failure) {
      setError(messageOf(failure, t));
      setBusy(false);
    }
  };

  const unlock = async (person: StaffView) => {
    try {
      await controller.api.unlockStaff({ body: { staffId: person.id } });
      toast.show({ title: t('staff.unlocked', { name: person.displayName }), tone: 'success' });
      reload();
    } catch (failure) {
      toast.show({ title: messageOf(failure, t), tone: 'danger' });
    }
  };

  if (me === undefined) return null;
  const actor: StaffActorView = { staffId: me.id, role: me.role };

  let content: ReactNode;
  if (data.status === 'loading') {
    content = <LoadingState title={t('states.loading')} />;
  } else if (data.status === 'error') {
    content = (
      <ErrorState
        title={t('staff.loadFailed')}
        description={messageOf(data.error, t)}
        onRetry={reload}
        retryLabel={t('states.retry')}
      />
    );
  } else {
    const others = data.value.staff.filter((person) => person.id !== me.id);
    const active = data.value.staff.filter((person) => person.active);
    const inactive = data.value.staff.filter((person) => !person.active);
    const row = (person: StaffView) => (
      <StaffRow
        key={person.id}
        person={person}
        self={person.id === me.id}
        actions={staffActions(actor, person, now)}
        now={now}
        onAction={(action) => {
          if (action === 'UNLOCK') void unlock(person);
          else setOpen({ kind: action, person });
        }}
      />
    );
    // Grouped by what people do (P9-26): who runs the place, the floor, the kitchen; the people
    // who left folded away under them.
    content = (
      <>
        {others.length === 0 ? <EmptyState title={t('staff.none')} /> : null}
        {GROUPS.map((group) => {
          const people = active.filter((person) => groupOf(person) === group);
          if (people.length === 0) return null;
          return (
            <section key={group} className="staff-group" aria-labelledby={`staff-group-${group}`}>
              <h3 id={`staff-group-${group}`} className="staff-group__title">
                {t(`staff.groups.${group}`)}
                <span className="staff-group__count">{people.length}</span>
              </h3>
              <ul className="staff-list">{people.map(row)}</ul>
            </section>
          );
        })}
        {inactive.length === 0 ? null : (
          <details className="staff-group staff-group--inactive">
            <summary className="staff-group__title">
              {t('staff.groups.INACTIVE')}
              <span className="staff-group__count">{inactive.length}</span>
            </summary>
            <ul className="staff-list">{inactive.map(row)}</ul>
          </details>
        )}
      </>
    );
  }

  const pinLength = data.status === 'ready' ? data.value.pinLength : 4;
  const signedIn =
    data.status === 'ready' ? data.value.staff.filter((person) => person.signedIn === true) : [];
  const activeCount =
    data.status === 'ready' ? data.value.staff.filter((person) => person.active).length : 0;
  return (
    <section className="dashboard-section" aria-labelledby="dashboard-staff">
      <div className="staff-header">
        <div>
          <h2 id="dashboard-staff" className="dashboard-section__heading">
            {t('staff.title')}
          </h2>
          {data.status === 'ready' ? (
            <p className="staff-header__summary">
              {t('staff.summary', { count: activeCount, signedIn: signedIn.length })}
            </p>
          ) : null}
        </div>
        <Button
          startIcon={<Icon name="plus" />}
          disabled={data.status !== 'ready'}
          onClick={() => {
            setOpen({ kind: 'ADD' });
          }}
        >
          {t('staff.add')}
        </Button>
      </div>
      {content}
      {open?.kind === 'ADD' || open?.kind === 'EDIT' ? (
        <PersonDialog
          actor={actor}
          person={open.kind === 'EDIT' ? open.person : undefined}
          customRoles={data.status === 'ready' ? data.value.roles : []}
          pinLength={pinLength}
          onSaved={(saved) => {
            done(
              t(open.kind === 'ADD' ? 'staff.added' : 'staff.saved', { name: saved.displayName }),
            );
          }}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'SET_PIN' ? (
        <PinDialog
          person={open.person}
          self={open.person.id === me.id}
          pinLength={pinLength}
          onSaved={() => {
            done(t('staff.pinSaved', { name: open.person.displayName }));
          }}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'DEACTIVATE' ? (
        <ReasonDialog
          title={t('staff.deactivateDialog.title', { name: open.person.displayName })}
          description={t('staff.deactivateDialog.description', { name: open.person.displayName })}
          label={t('staff.deactivateDialog.reason')}
          confirmLabel={t('staff.deactivateDialog.confirm')}
          tone="danger"
          busy={busy}
          error={error}
          onConfirm={(reason) => {
            const { person } = open;
            void run(
              () =>
                controller.api.deactivateStaff({
                  params: { staffId: person.id },
                  body: { reason },
                }),
              t('staff.deactivated', { name: person.displayName }),
            );
          }}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'REACTIVATE' ? (
        <ConfirmDialog
          open
          tone="primary"
          title={t('staff.reactivateDialog.title', { name: open.person.displayName })}
          confirmLabel={t('staff.reactivateDialog.confirm')}
          cancelLabel={t('staff.reactivateDialog.cancel')}
          busy={busy}
          onConfirm={() => {
            const { person } = open;
            void run(
              () => controller.api.reactivateStaff({ params: { staffId: person.id } }),
              t('staff.reactivated', { name: person.displayName }),
            );
          }}
          onCancel={close}
        >
          {error === undefined ? null : (
            <p role="alert" className="console-notice console-notice--danger">
              {error}
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

const GROUPS: readonly StaffGroup[] = ['LEADS', 'WAITERS', 'KITCHEN'];

const ACTION_LABELS = {
  EDIT: 'staff.edit',
  UNLOCK: 'staff.unlock',
  DEACTIVATE: 'staff.deactivate',
  REACTIVATE: 'staff.reactivate',
} as const;

/**
 * One person (P9-26): an initial, their name, one quiet line (role, phone, when they were last
 * here) and only the states that need attention: no PIN yet, or a locked login. Deactivating is
 * the quieter, last button.
 */
function StaffRow({
  person,
  self,
  actions,
  now,
  onAction,
}: {
  person: StaffView;
  self: boolean;
  actions: readonly StaffAction[];
  now: number;
  onAction: (action: StaffAction) => void;
}) {
  const t = useT();
  const locked = isLocked(person, now);
  const seen = person.active ? lastSeenOf(person, now) : undefined;
  const role =
    person.customRoleName === null
      ? t(`roles.${person.role}`)
      : t('staff.customRole', { name: person.customRoleName, role: t(`roles.${person.role}`) });
  const facts = [
    // The role is the group's title already; a custom role or the Owner still says which.
    (person.customRoleName !== null || person.role === 'OWNER' || !person.active) &&
    !person.displayName.toLowerCase().includes(role.toLowerCase())
      ? role
      : null,
    person.phone === null ? null : displayPhone(person.phone),
    person.email,
  ].filter((fact): fact is string => fact !== null && fact !== '');
  return (
    <li className="staff-row" data-inactive={!person.active || undefined}>
      <span className="staff-row__avatar" data-role={person.role} aria-hidden="true">
        {initialsOf(person.displayName)}
      </span>
      <div className="staff-row__who">
        <p className="staff-row__name">
          {person.displayName}
          {self ? <Badge tone="info">{t('staff.you')}</Badge> : null}
          {person.hasPin ? null : <Badge tone="warning">{t('staff.noPin')}</Badge>}
          {locked && person.lockedUntil !== null ? (
            <Badge tone="danger" icon={<Icon name="warning" />}>
              {t('staff.lockedUntil', { time: timeOfDayOf(new Date(person.lockedUntil)) })}
            </Badge>
          ) : null}
        </p>
        <p className="staff-row__meta">
          {seen === undefined ? null : (
            <span className="staff-row__seen" data-now={seen.kind === 'NOW' || undefined}>
              {seen.kind === 'NOW'
                ? t('staff.seen.now')
                : seen.kind === 'NEVER'
                  ? t('staff.seen.never')
                  : seen.kind === 'ON'
                    ? t('staff.seen.on', { date: seen.date })
                    : t(`staff.seen.${seen.kind === 'TODAY' ? 'today' : 'yesterday'}`, {
                        time: seen.time,
                      })}
            </span>
          )}
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      </div>
      {actions.length === 0 ? null : (
        <div
          className="staff-row__actions"
          role="group"
          aria-label={t('staff.actionsFor', { name: person.displayName })}
        >
          {actions.map((action) => (
            <Button
              key={action}
              variant={action === 'DEACTIVATE' ? 'ghost' : 'secondary'}
              onClick={() => {
                onAction(action);
              }}
            >
              {action === 'SET_PIN'
                ? t(person.hasPin ? 'staff.changePin' : 'staff.setPin')
                : t(ACTION_LABELS[action])}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}
