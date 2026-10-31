/**
 * Notification rules (P2-03, NTF-001 to NTF-009, BRD Appendix C): which events alert whom, on which
 * channels, what a pager shows, whether an unacknowledged alert repeats and escalates to the
 * managers on duty. Pure: the server resolves the people and keeps the deadlines.
 */

export const NOTIFICATION_EVENTS = [
  'ORDER_PENDING_APPROVAL',
  'ITEM_READY',
  'WATER_REQUEST',
  'WAITER_REQUEST',
  'BILL_REQUEST',
  'READY_NOT_COLLECTED',
  'MANAGER_NUDGE',
  'ORDER_CHANGED',
  'WAITER_UNREACHABLE',
  'DEVICE_LOW_BATTERY_OR_OFFLINE',
  'PRINTER_OFFLINE',
  'DISK_OR_BACKUP',
  'LICENSE_STATE',
  /** The daily suspicious-activity report found something (AUD-006, P4-07b). */
  'SUSPICIOUS_ACTIVITY',
  /** Vendor support asks for diagnostics; a manager allows or declines it (UPD-008, P7-08b). */
  'SUPPORT_REQUEST',
  /** The vendor issued a code that opens this restaurant's cloud backups (DATA-003, P7-05e). */
  'VENDOR_RESTORE_CODE',
  /** Wrong PINs or passwords locked a person's sign-in, or stopped a device taking them (PC-S5). */
  'SIGN_IN_LOCKED',
  /** A dish on a ticket was marked out of stock and its unstarted units cancelled (ADR-0023). */
  'OUT_OF_STOCK',
  /** A diner says they paid the printed bill by UPI from the QR page (ADR-0024, P9-03). */
  'PAYMENT_CLAIMED',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Who an alert goes to (NTF-002). */
export const RECIPIENT_KINDS = [
  /** Every waiter on duty: any waiter may serve any table (ADR-0023). */
  'ALL_WAITERS',
  'MANAGERS_ON_DUTY',
  'STATION',
  'OWNER',
  /** The person wearing a pager, for its own battery (Appendix C). */
  'WEARER',
  /** The waiters a manager chose for a nudge (NTF-008). */
  'SELECTED',
  /**
   * The person who sent the KOT the alert is about (for a diner's order, the waiter who approved
   * it); every waiter on duty when they are off duty or unknown (ADR-0023).
   */
  'KOT_SENDER',
] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

export const NOTIFICATION_CHANNELS = [
  'PAGER',
  'WAITER_APP',
  'POS',
  'DASHBOARD',
  'KDS',
  'TABLET',
  'PRINTED_SLIP',
  'CONTROL_PLANE',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * How an alert comes back: every R seconds until acknowledged, never, once per state change, until
 * the cause is resolved, or once a day. `AUTO_CLOSE` alerts once and closes itself after a while:
 * a message with no cause that could go away, such as a manager's nudge.
 */
export const REPEAT_POLICIES = [
  'UNTIL_ACKED',
  'NONE',
  'ONCE_PER_STATE',
  'UNTIL_RESOLVED',
  'DAILY',
  'AUTO_CLOSE',
] as const;
export type RepeatPolicy = (typeof REPEAT_POLICIES)[number];

export interface NotificationRule {
  readonly recipients: readonly RecipientKind[];
  readonly channels: readonly NotificationChannel[];
  /** What a pager shows; `{table}` and `{message}` are filled in. Null: no pager text. */
  readonly pagerText: string | null;
  /** Unacknowledged after N seconds, the managers on duty are alerted too (NTF-005). */
  readonly escalate: boolean;
  readonly repeat: RepeatPolicy;
}

const rule = (
  recipients: readonly RecipientKind[],
  channels: readonly NotificationChannel[],
  pagerText: string | null,
  escalate: boolean,
  repeat: RepeatPolicy,
): NotificationRule => ({ recipients, channels, pagerText, escalate, repeat });

/**
 * BRD Appendix C, the factory defaults (N = R = 60 s are settings), with the Business Owner's
 * change of 2026-10-25 for the waiters' alerts: they ring once and need no acknowledgement. Each
 * escalates when its cause is still there after N (an order not approved, a request nobody
 * answered), and food ready escalates from the kitchen instead, when nobody picks it up within
 * `kds.readyNotCollectedMinutes` (KDS-006). A manager can bring the repeats back per rule.
 */
export const DEFAULT_NOTIFICATION_RULES: Readonly<Record<NotificationEvent, NotificationRule>> = {
  // ADR-0024: the managers on duty too, so a manager's phone rings for every diner's order (QR
  // pilot); a restaurant can take them off on the Notification rules page (NTF-002).
  ORDER_PENDING_APPROVAL: rule(
    ['ALL_WAITERS', 'MANAGERS_ON_DUTY'],
    ['PAGER', 'WAITER_APP', 'POS'],
    '{table} NEW ORDER',
    true,
    'NONE',
  ),
  ITEM_READY: rule(
    ['ALL_WAITERS'],
    ['PAGER', 'WAITER_APP', 'TABLET'],
    '{table} READY',
    false,
    'NONE',
  ),
  WATER_REQUEST: rule(['ALL_WAITERS'], ['PAGER', 'WAITER_APP'], '{table} WATER', true, 'NONE'),
  WAITER_REQUEST: rule(['ALL_WAITERS'], ['PAGER', 'WAITER_APP'], '{table} WAITER', true, 'NONE'),
  // The cashier's part goes to the managers on duty, who bill now, and the table's to every waiter
  // on duty (ADR-0023).
  BILL_REQUEST: rule(
    ['ALL_WAITERS', 'MANAGERS_ON_DUTY'],
    ['PAGER', 'WAITER_APP', 'POS'],
    '{table} BILL',
    true,
    'NONE',
  ),
  READY_NOT_COLLECTED: rule(
    ['MANAGERS_ON_DUTY'],
    ['POS', 'DASHBOARD', 'PAGER'],
    '{table} FOOD WAITING',
    false,
    'UNTIL_ACKED',
  ),
  MANAGER_NUDGE: rule(['SELECTED'], ['PAGER', 'WAITER_APP'], 'MGR: {message}', false, 'AUTO_CLOSE'),
  ORDER_CHANGED: rule(['STATION'], ['KDS', 'PRINTED_SLIP'], null, false, 'NONE'),
  WAITER_UNREACHABLE: rule(['MANAGERS_ON_DUTY'], ['POS', 'DASHBOARD'], null, false, 'NONE'),
  DEVICE_LOW_BATTERY_OR_OFFLINE: rule(
    ['MANAGERS_ON_DUTY', 'WEARER'],
    ['DASHBOARD', 'WAITER_APP', 'PAGER'],
    'LOW BATTERY',
    false,
    'ONCE_PER_STATE',
  ),
  PRINTER_OFFLINE: rule(['MANAGERS_ON_DUTY'], ['POS', 'DASHBOARD'], null, false, 'UNTIL_RESOLVED'),
  DISK_OR_BACKUP: rule(
    ['OWNER', 'MANAGERS_ON_DUTY'],
    ['POS', 'DASHBOARD', 'CONTROL_PLANE'],
    null,
    false,
    'DAILY',
  ),
  LICENSE_STATE: rule(['OWNER', 'MANAGERS_ON_DUTY'], ['POS', 'DASHBOARD'], null, false, 'DAILY'),
  // Not in Appendix C: AUD-006's daily report goes to the Owner only, once.
  SUSPICIOUS_ACTIVITY: rule(['OWNER'], ['DASHBOARD', 'CONTROL_PLANE'], null, false, 'NONE'),
  // Not in Appendix C: support's request waits on the dashboard until it is answered (UPD-008).
  SUPPORT_REQUEST: rule(
    ['OWNER', 'MANAGERS_ON_DUTY'],
    ['DASHBOARD'],
    null,
    false,
    'UNTIL_RESOLVED',
  ),
  // Not in Appendix C: the Owner hears whenever the vendor can open the backups (OI-10).
  VENDOR_RESTORE_CODE: rule(['OWNER'], ['POS', 'DASHBOARD'], null, false, 'NONE'),
  // Not in Appendix C: a lockout may be someone guessing PINs, and a manager can lift it (PC-S5).
  SIGN_IN_LOCKED: rule(['OWNER', 'MANAGERS_ON_DUTY'], ['POS', 'DASHBOARD'], null, false, 'NONE'),
  // ADR-0023: one per ticket line whose units were cancelled, to whoever sent the ticket.
  OUT_OF_STOCK: rule(
    ['KOT_SENDER'],
    ['PAGER', 'WAITER_APP', 'POS'],
    '{table} OUT OF STOCK',
    false,
    'NONE',
  ),
  // ADR-0024: whoever takes payments checks their UPI app, then settles the bill at the POS.
  PAYMENT_CLAIMED: rule(
    ['ALL_WAITERS', 'MANAGERS_ON_DUTY'],
    ['PAGER', 'WAITER_APP', 'POS'],
    '{table} PAID UPI',
    true,
    'NONE',
  ),
};

/** A manager's change to one event's rule (NTF-002); anything left out keeps the default. */
export type NotificationRuleOverride = Partial<NotificationRule>;

export function effectiveRule(
  event: NotificationEvent,
  overrides: Readonly<Partial<Record<NotificationEvent, NotificationRuleOverride>>> = {},
): NotificationRule {
  return { ...DEFAULT_NOTIFICATION_RULES[event], ...overrides[event] };
}

/** Recipients any event can go to; the special ones only where Appendix C uses them. */
const GENERAL_RECIPIENTS: readonly RecipientKind[] = ['ALL_WAITERS', 'MANAGERS_ON_DUTY', 'OWNER'];
const GENERAL_CHANNELS: readonly NotificationChannel[] = [
  'PAGER',
  'WAITER_APP',
  'POS',
  'DASHBOARD',
];

/**
 * Who a manager may send an event to (NTF-002): the usual people, plus a station, a pager's wearer
 * or the chosen waiters only for the events that have one.
 */
export function recipientChoices(event: NotificationEvent): RecipientKind[] {
  const own = DEFAULT_NOTIFICATION_RULES[event].recipients;
  return RECIPIENT_KINDS.filter((kind) => GENERAL_RECIPIENTS.includes(kind) || own.includes(kind));
}

/** Where an event can show: the usual channels, plus the kitchen, tablet, slip or vendor where it has them. */
export function channelChoices(event: NotificationEvent): NotificationChannel[] {
  const own = DEFAULT_NOTIFICATION_RULES[event].channels;
  return NOTIFICATION_CHANNELS.filter(
    (channel) => GENERAL_CHANNELS.includes(channel) || own.includes(channel),
  );
}

const sameSet = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/**
 * What a manager's rule changes from the factory one (NTF-002), field by field; undefined when it
 * is the factory rule. Only this difference is stored, so later factory changes still apply.
 */
export function ruleOverride(
  event: NotificationEvent,
  rule: NotificationRule,
): NotificationRuleOverride | undefined {
  const factory = DEFAULT_NOTIFICATION_RULES[event];
  const override: { -readonly [K in keyof NotificationRule]?: NotificationRule[K] } = {};
  if (!sameSet(rule.recipients, factory.recipients)) override.recipients = rule.recipients;
  if (!sameSet(rule.channels, factory.channels)) override.channels = rule.channels;
  if (rule.pagerText !== factory.pagerText) override.pagerText = rule.pagerText;
  if (rule.escalate !== factory.escalate) override.escalate = rule.escalate;
  if (rule.repeat !== factory.repeat) override.repeat = rule.repeat;
  return Object.keys(override).length === 0 ? undefined : override;
}

export type NotificationRuleProblem =
  'RECIPIENTS_REQUIRED' | 'CHANNELS_REQUIRED' | 'PAGER_TEXT_REQUIRED' | 'PAGER_TEXT_TOO_LONG';

/** A rule must reach someone somewhere, and a pager alert needs its line of text. */
export function checkRule(rule: NotificationRule): NotificationRuleProblem[] {
  const problems: NotificationRuleProblem[] = [];
  if (rule.recipients.length === 0) problems.push('RECIPIENTS_REQUIRED');
  if (rule.channels.length === 0) problems.push('CHANNELS_REQUIRED');
  if (rule.channels.includes('PAGER')) {
    if (rule.pagerText === null || rule.pagerText.trim() === '') {
      problems.push('PAGER_TEXT_REQUIRED');
    } else if (rule.pagerText.trim().length > PAGER_TEXT_MAX) {
      problems.push('PAGER_TEXT_TOO_LONG');
    }
  }
  return problems;
}

/** A pager line: at most 20 characters on the wrist display (PGR), in capitals as Appendix C. */
export const PAGER_TEXT_MAX = 20;

/** "5" → "T5"; a label that already starts with letters ("Patio 2") stays as it is. */
function tableTag(label: string | null | undefined): string {
  if (label === undefined || label === null) return '';
  return /^\d/.test(label) ? `T${label}` : label;
}

export function pagerTextFor(
  template: string | null,
  values: { readonly table?: string | null; readonly message?: string | null },
): string | null {
  if (template === null) return null;
  const text = template
    .replace('{table}', tableTag(values.table))
    .replace('{message}', values.message ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const shown = template.includes('{message}') ? text : text.toUpperCase();
  return shown.slice(0, PAGER_TEXT_MAX);
}

/** What decides where an alert shows: the people it went to and its channels. */
export interface AlertDelivery {
  readonly recipientIds: readonly string[];
  readonly channels: readonly string[];
  readonly escalatedTo: readonly string[];
}

/**
 * Whether an alert goes to the person's pager and waiter app (P2-06a). Both show the same alerts
 * (WTR-006): those the person receives whose rule names the pager or the app, and any alert
 * escalated to them, which reaches a manager's pager and app whatever its channels (NTF-005).
 */
export function reachesPagerAndApp(alert: AlertDelivery, staffId: string): boolean {
  if (!alert.recipientIds.includes(staffId)) return false;
  return (
    alert.channels.includes('PAGER') ||
    alert.channels.includes('WAITER_APP') ||
    alert.escalatedTo.includes(staffId)
  );
}

/**
 * Whether an alert asks for the person at the console, on the POS or the manager dashboard
 * (P2-06c, MGR-008): they receive it and its rule names one of those, or it was escalated to them,
 * which reaches the managers' screens whatever its channels (NTF-005). Managers also see everyone
 * else's open alerts there, without being asked to act on them.
 */
export function reachesConsole(alert: AlertDelivery, staffId: string): boolean {
  if (!alert.recipientIds.includes(staffId)) return false;
  return (
    alert.channels.includes('POS') ||
    alert.channels.includes('DASHBOARD') ||
    alert.escalatedTo.includes(staffId)
  );
}

/** The restaurant's people as they are right now, for resolving a rule. */
export interface RecipientContext {
  /** Every active waiter; those on duty (`onDuty`) are alerted. */
  readonly allWaiterIds: readonly string[];
  readonly managersOnDuty: readonly string[];
  readonly ownerIds: readonly string[];
  readonly selectedIds: readonly string[];
  readonly wearerId: string | null;
  /** Who sent the KOT the alert is about (ADR-0023), if anyone. */
  readonly kotSenderId?: string | null;
  /**
   * Whether a person is on duty now: signed in, or their pager or phone connected (D-17). Someone
   * off duty does not get a KOT's alerts; every waiter on duty does instead.
   */
  readonly onDuty?: (staffId: string) => boolean;
  /** Waiters who set "On break" (NTF-009): their alerts go to the managers until they return. */
  readonly onBreak: ReadonlySet<string>;
  /** Whether a person's pager or waiter app is connected (NTF-007). */
  readonly reachable: (staffId: string) => boolean;
  /**
   * The person whose own request raised the alert, e.g. a waiter asking for the bill on their phone
   * (P2-06d): they know already, so they are not alerted.
   */
  readonly askedById?: string | null;
}

export interface ResolvedRecipients {
  readonly staffIds: readonly string[];
  /** The station(s) of the event are alerted (kitchen screens and slips). */
  readonly stations: boolean;
  /**
   * The managers are alerted now instead of after N seconds: no waiter is there to take it (all off
   * duty or on break), or none of them has a pager or app connected (NTF-007, NTF-009).
   */
  readonly escalateNow: boolean;
}

const WAITER_KINDS: ReadonlySet<RecipientKind> = new Set(['ALL_WAITERS', 'SELECTED', 'KOT_SENDER']);

export function resolveRecipients(
  rule: NotificationRule,
  context: RecipientContext,
): ResolvedRecipients {
  const people = new Set<string>();
  let waiterWanted = false;
  let waiterFound = false;
  let stations = false;
  let escalateNow = false;
  const addWaiters = (ids: readonly string[]) => {
    for (const id of ids) {
      if (context.onBreak.has(id)) continue;
      people.add(id);
      waiterFound = true;
    }
  };
  for (const kind of rule.recipients) {
    if (WAITER_KINDS.has(kind)) waiterWanted = true;
    switch (kind) {
      case 'ALL_WAITERS': {
        const onDuty = context.onDuty ?? (() => true);
        const waiters = context.allWaiterIds.filter((id) => onDuty(id) && !context.onBreak.has(id));
        addWaiters(waiters);
        // Whoever asked knows already, so is there for it; NTF-007: none of the others can hear it.
        const others = waiters.filter((id) => id !== context.askedById);
        if (others.length < waiters.length) waiterFound = true;
        if (others.length > 0 && !others.some((id) => context.reachable(id))) escalateNow = true;
        break;
      }
      case 'SELECTED':
        addWaiters(context.selectedIds);
        break;
      case 'KOT_SENDER': {
        const sender = context.kotSenderId ?? null;
        if (sender !== null && sender === context.askedById) {
          waiterFound = true;
          break;
        }
        const onDuty = context.onDuty ?? (() => true);
        if (sender === null || !onDuty(sender)) {
          // Signed out or unknown: whoever is on duty takes it (D-17).
          addWaiters(context.allWaiterIds.filter((id) => onDuty(id)));
          break;
        }
        if (context.onBreak.has(sender)) {
          escalateNow = true;
          break;
        }
        if (!context.reachable(sender)) escalateNow = true;
        people.add(sender);
        waiterFound = true;
        break;
      }
      case 'MANAGERS_ON_DUTY':
        for (const id of context.managersOnDuty) people.add(id);
        break;
      case 'OWNER':
        for (const id of context.ownerIds) people.add(id);
        break;
      case 'WEARER':
        if (context.wearerId !== null) people.add(context.wearerId);
        break;
      case 'STATION':
        stations = true;
        break;
    }
  }
  // Whoever asked knows already; an escalation still reaches every manager on duty.
  if (context.askedById !== undefined && context.askedById !== null) {
    people.delete(context.askedById);
  }
  // Nobody to take a waiter's alert: the managers take it at once.
  if (waiterWanted && !waiterFound) escalateNow = true;
  if (escalateNow) for (const id of context.managersOnDuty) people.add(id);
  return { staffIds: [...people], stations, escalateNow };
}

/** When an alert next needs attention (persisted, so timers survive a restart). */
export interface AlertDeadlines {
  readonly escalateAt: Date | null;
  readonly nextRepeatAt: Date | null;
}

export interface NotificationTiming {
  /** N (NTF-005), seconds. */
  readonly escalationSeconds: number;
  /** R (NTF-002), seconds. */
  readonly repeatSeconds: number;
  /** How long an `AUTO_CLOSE` alert stays open, seconds. */
  readonly closeSeconds: number;
}

const later = (from: Date, seconds: number) => new Date(from.getTime() + seconds * 1000);

export function initialDeadlines(
  rule: NotificationRule,
  now: Date,
  timing: NotificationTiming,
  escalatedAlready: boolean,
): AlertDeadlines {
  return {
    escalateAt: rule.escalate && !escalatedAlready ? later(now, timing.escalationSeconds) : null,
    // An `AUTO_CLOSE` alert's one "repeat" is when it closes.
    nextRepeatAt:
      rule.repeat === 'UNTIL_ACKED' || rule.repeat === 'UNTIL_RESOLVED'
        ? later(now, timing.repeatSeconds)
        : rule.repeat === 'DAILY'
          ? later(now, 24 * 60 * 60)
          : rule.repeat === 'AUTO_CLOSE'
            ? later(now, timing.closeSeconds)
            : null,
  };
}

export type DueAction =
  | { readonly kind: 'ESCALATE'; readonly next: AlertDeadlines }
  | { readonly kind: 'REPEAT'; readonly next: AlertDeadlines }
  | { readonly kind: 'CLOSE' };

/**
 * What an open alert needs at `now`: escalation first (NTF-005), then a repeat (every R until
 * acknowledged). Several missed repeats (the server was down) come out as one repeat, not a burst.
 * An `AUTO_CLOSE` alert whose time is up only closes.
 */
export function dueActions(
  rule: NotificationRule,
  deadlines: AlertDeadlines,
  now: Date,
  timing: NotificationTiming,
): DueAction[] {
  if (rule.repeat === 'AUTO_CLOSE' && deadlines.nextRepeatAt !== null) {
    return deadlines.nextRepeatAt <= now ? [{ kind: 'CLOSE' }] : [];
  }
  const actions: DueAction[] = [];
  let { escalateAt, nextRepeatAt } = deadlines;
  if (escalateAt !== null && escalateAt <= now) {
    escalateAt = null;
    actions.push({ kind: 'ESCALATE', next: { escalateAt, nextRepeatAt } });
  }
  if (nextRepeatAt !== null && nextRepeatAt <= now) {
    const step = rule.repeat === 'DAILY' ? 24 * 60 * 60 : timing.repeatSeconds;
    let next = nextRepeatAt;
    while (next <= now) next = later(next, step);
    nextRepeatAt = next;
    actions.push({ kind: 'REPEAT', next: { escalateAt, nextRepeatAt } });
  }
  return actions;
}
