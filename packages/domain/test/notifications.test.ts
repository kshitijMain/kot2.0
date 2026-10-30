import { describe, expect, it } from 'vitest';
import {
  channelChoices,
  checkRule,
  DEFAULT_NOTIFICATION_RULES,
  dueActions,
  effectiveRule,
  initialDeadlines,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  pagerTextFor,
  reachesConsole,
  reachesPagerAndApp,
  RECIPIENT_KINDS,
  type RecipientContext,
  recipientChoices,
  resolveRecipients,
  ruleOverride,
} from '../src/index.js';

const context = (overrides: Partial<RecipientContext> = {}): RecipientContext => ({
  responsibleWaiterId: 'ravi',
  sectionWaiterIds: ['ravi', 'sunita'],
  allWaiterIds: ['ravi', 'sunita', 'arjun'],
  managersOnDuty: ['vikram'],
  ownerIds: ['asha'],
  selectedIds: ['sunita'],
  wearerId: 'arjun',
  kotSenderId: 'sunita',
  onDuty: () => true,
  onBreak: new Set(),
  reachable: () => true,
  ...overrides,
});

const TIMING = { escalationSeconds: 60, repeatSeconds: 60, closeSeconds: 600 };
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 26, 12, 0, seconds));

describe('[NTF-002] [NTF-003] the Appendix C matrix', () => {
  // Event, recipients with everyone reachable, pager text for table 7, escalates, repeat. The
  // waiters' alerts ring once and need no acknowledgement (Business Owner, 2026-10-25): food ready
  // escalates from the kitchen (KDS-006), a nudge closes itself.
  const MATRIX: readonly [NotificationEvent, string[], string | null, boolean, string][] = [
    ['ORDER_PENDING_APPROVAL', ['ravi'], 'T7 NEW ORDER', true, 'NONE'],
    ['ITEM_READY', ['ravi'], 'T7 READY', false, 'NONE'],
    ['WATER_REQUEST', ['ravi'], 'T7 WATER', true, 'NONE'],
    ['WAITER_REQUEST', ['ravi'], 'T7 WAITER', true, 'NONE'],
    ['BILL_REQUEST', ['ravi', 'vikram'], 'T7 BILL', true, 'NONE'],
    ['READY_NOT_COLLECTED', ['vikram'], 'T7 FOOD WAITING', false, 'UNTIL_ACKED'],
    ['MANAGER_NUDGE', ['sunita'], 'MGR: Check T7', false, 'AUTO_CLOSE'],
    ['ORDER_CHANGED', [], null, false, 'NONE'],
    ['WAITER_UNREACHABLE', ['vikram'], null, false, 'NONE'],
    ['DEVICE_LOW_BATTERY_OR_OFFLINE', ['vikram', 'arjun'], 'LOW BATTERY', false, 'ONCE_PER_STATE'],
    ['PRINTER_OFFLINE', ['vikram'], null, false, 'UNTIL_RESOLVED'],
    ['DISK_OR_BACKUP', ['asha', 'vikram'], null, false, 'DAILY'],
    ['LICENSE_STATE', ['asha', 'vikram'], null, false, 'DAILY'],
    ['SUSPICIOUS_ACTIVITY', ['asha'], null, false, 'NONE'],
    ['SUPPORT_REQUEST', ['asha', 'vikram'], null, false, 'UNTIL_RESOLVED'],
    ['VENDOR_RESTORE_CODE', ['asha'], null, false, 'NONE'],
    ['SIGN_IN_LOCKED', ['asha', 'vikram'], null, false, 'NONE'],
    ['OUT_OF_STOCK', ['sunita'], 'T7 OUT OF STOCK', false, 'NONE'],
  ];

  it('covers every event type', () => {
    expect(MATRIX.map(([event]) => event).sort()).toEqual([...NOTIFICATION_EVENTS].sort());
  });

  it.each(MATRIX)('%s', (event, people, pager, escalate, repeat) => {
    const rule = DEFAULT_NOTIFICATION_RULES[event];
    const resolved = resolveRecipients(rule, context());
    expect(resolved.staffIds).toEqual(people);
    expect(resolved.escalateNow).toBe(false);
    expect(resolved.stations).toBe(event === 'ORDER_CHANGED');
    expect(pagerTextFor(rule.pagerText, { table: '7', message: 'Check T7' })).toBe(pager);
    expect(rule.escalate).toBe(escalate);
    expect(rule.repeat).toBe(repeat);
  });
});

describe('[NTF-005] [NTF-007] [NTF-009] recipients', () => {
  const ready = DEFAULT_NOTIFICATION_RULES.ITEM_READY;

  it('goes to the managers at once when the waiter has neither pager nor app connected', () => {
    const resolved = resolveRecipients(ready, context({ reachable: (id) => id !== 'ravi' }));
    expect(resolved).toEqual({ staffIds: ['ravi', 'vikram'], stations: false, escalateNow: true });
  });

  it('goes to the managers while the waiter is on break, and when nobody looks after the table', () => {
    expect(resolveRecipients(ready, context({ onBreak: new Set(['ravi']) }))).toEqual({
      staffIds: ['vikram'],
      stations: false,
      escalateNow: true,
    });
    expect(resolveRecipients(ready, context({ responsibleWaiterId: null })).staffIds).toEqual([
      'vikram',
    ]);
    const section = effectiveRule('WATER_REQUEST', {
      WATER_REQUEST: { recipients: ['SECTION_WAITERS'] },
    });
    expect(
      resolveRecipients(section, context({ onBreak: new Set(['ravi', 'sunita']) })),
    ).toMatchObject({ staffIds: ['vikram'], escalateNow: true });
    expect(resolveRecipients(section, context({ onBreak: new Set(['ravi']) })).staffIds).toEqual([
      'sunita',
    ]);
  });

  it('[BILL-015] does not alert the waiter who asked for the bill; the managers on duty still hear', () => {
    const bill = DEFAULT_NOTIFICATION_RULES.BILL_REQUEST;
    // The cashier's alerts go to the managers on duty (ADR-0023).
    expect(bill.recipients).toEqual(['RESPONSIBLE_WAITER', 'MANAGERS_ON_DUTY']);
    // Ravi asked on his phone: not alerted, and not "missing", even with his pager off.
    expect(
      resolveRecipients(bill, context({ askedById: 'ravi', reachable: (id) => id !== 'ravi' })),
    ).toEqual({ staffIds: ['vikram'], stations: false, escalateNow: false });
    // Vikram asked at the POS: Ravi is told, Vikram is not.
    expect(resolveRecipients(bill, context({ askedById: 'vikram' })).staffIds).toEqual(['ravi']);
    // Someone else's request changes nothing.
    expect(resolveRecipients(bill, context({ askedById: null })).staffIds).toEqual([
      'ravi',
      'vikram',
    ]);
    // A manager who asked while nobody looks after the table is still called with the others.
    expect(
      resolveRecipients(bill, context({ askedById: 'vikram', responsibleWaiterId: null })),
    ).toEqual({ staffIds: ['vikram'], stations: false, escalateNow: true });
  });

  it('lets a manager send an event to all waiters or the managers instead (NTF-002)', () => {
    const rule = effectiveRule('WATER_REQUEST', {
      WATER_REQUEST: { recipients: ['ALL_WAITERS', 'MANAGERS_ON_DUTY'], escalate: false },
    });
    expect(rule.channels).toEqual(['PAGER', 'WAITER_APP']);
    expect(resolveRecipients(rule, context()).staffIds).toEqual([
      'ravi',
      'sunita',
      'arjun',
      'vikram',
    ]);
    expect(effectiveRule('ITEM_READY')).toEqual(DEFAULT_NOTIFICATION_RULES.ITEM_READY);
  });
});

describe('[NTF-002] the waiter who sent the KOT (ADR-0023)', () => {
  const outOfStock = DEFAULT_NOTIFICATION_RULES.OUT_OF_STOCK;

  it('alerts only the person who sent the ticket', () => {
    expect(outOfStock.recipients).toEqual(['KOT_SENDER']);
    expect(resolveRecipients(outOfStock, context())).toEqual({
      staffIds: ['sunita'],
      stations: false,
      escalateNow: false,
    });
  });

  it('alerts every waiter on duty when the sender is off duty or unknown (D-17)', () => {
    const offDuty = context({ onDuty: (id) => id !== 'sunita', allWaiterIds: ['ravi', 'arjun'] });
    expect(resolveRecipients(outOfStock, offDuty)).toEqual({
      staffIds: ['ravi', 'arjun'],
      stations: false,
      escalateNow: false,
    });
    expect(
      resolveRecipients(outOfStock, context({ kotSenderId: null, allWaiterIds: ['ravi'] }))
        .staffIds,
    ).toEqual(['ravi']);
  });

  it('calls the managers at once when nobody is there to take it', () => {
    expect(
      resolveRecipients(outOfStock, context({ onDuty: () => false, allWaiterIds: [] })),
    ).toEqual({ staffIds: ['vikram'], stations: false, escalateNow: true });
  });

  it('[NTF-007] [NTF-009] keeps the sender on break or unreachable to the managers', () => {
    expect(resolveRecipients(outOfStock, context({ onBreak: new Set(['sunita']) }))).toEqual({
      staffIds: ['vikram'],
      stations: false,
      escalateNow: true,
    });
    expect(resolveRecipients(outOfStock, context({ reachable: (id) => id !== 'sunita' }))).toEqual({
      staffIds: ['sunita', 'vikram'],
      stations: false,
      escalateNow: true,
    });
  });
});

describe('[NTF-004] [NTF-005] repeat and escalation deadlines', () => {
  // A manager can bring the repeats back (NTF-002), as the BRD's factory rule had them.
  const rule = { ...DEFAULT_NOTIFICATION_RULES.BILL_REQUEST, repeat: 'UNTIL_ACKED' as const };

  it('escalates a waiter’s alert after N without repeating it', () => {
    const once = DEFAULT_NOTIFICATION_RULES.WATER_REQUEST;
    const start = initialDeadlines(once, at(0), TIMING, false);
    expect(start).toEqual({ escalateAt: at(60), nextRepeatAt: null });
    expect(dueActions(once, start, at(60), TIMING).map((action) => action.kind)).toEqual([
      'ESCALATE',
    ]);
  });

  it('[NTF-008] closes a manager’s nudge by itself after a while, without escalating', () => {
    const nudge = DEFAULT_NOTIFICATION_RULES.MANAGER_NUDGE;
    const start = initialDeadlines(nudge, at(0), TIMING, false);
    expect(start).toEqual({ escalateAt: null, nextRepeatAt: at(600) });
    expect(dueActions(nudge, start, at(599), TIMING)).toEqual([]);
    expect(dueActions(nudge, start, at(600), TIMING)).toEqual([{ kind: 'CLOSE' }]);
  });

  it('escalates after N and repeats every R until acknowledged', () => {
    const start = initialDeadlines(rule, at(0), TIMING, false);
    expect(start).toEqual({ escalateAt: at(60), nextRepeatAt: at(60) });
    expect(dueActions(rule, start, at(59), TIMING)).toEqual([]);
    const due = dueActions(rule, start, at(60), TIMING);
    expect(due.map((action) => action.kind)).toEqual(['ESCALATE', 'REPEAT']);
    const last = due.at(-1);
    expect(last !== undefined && last.kind !== 'CLOSE' ? last.next : undefined).toEqual({
      escalateAt: null,
      nextRepeatAt: at(120),
    });
  });

  it('does not escalate twice, and folds missed repeats into one after a restart', () => {
    const escalated = initialDeadlines(rule, at(0), TIMING, true);
    expect(escalated.escalateAt).toBeNull();
    const due = dueActions(rule, { escalateAt: null, nextRepeatAt: at(60) }, at(250), TIMING);
    expect(due).toEqual([{ kind: 'REPEAT', next: { escalateAt: null, nextRepeatAt: at(300) } }]);
  });

  it('never repeats NONE or ONCE_PER_STATE alerts, and repeats DAILY ones a day later', () => {
    expect(
      initialDeadlines(DEFAULT_NOTIFICATION_RULES.ORDER_CHANGED, at(0), TIMING, false),
    ).toEqual({
      escalateAt: null,
      nextRepeatAt: null,
    });
    const daily = initialDeadlines(DEFAULT_NOTIFICATION_RULES.DISK_OR_BACKUP, at(0), TIMING, false);
    expect(daily.nextRepeatAt?.getTime()).toBe(at(0).getTime() + 86_400_000);
  });
});

describe('[NTF-008] pager text', () => {
  it('fits the pager and keeps a label that is not a number', () => {
    expect(pagerTextFor('{table} READY', { table: 'Patio 2' })).toBe('PATIO 2 READY');
    expect(pagerTextFor('MGR: {message}', { message: 'Come to the counter please now' })).toBe(
      'MGR: Come to the cou',
    );
    expect(pagerTextFor('{table} BILL', { table: null })).toBe('BILL');
    expect(pagerTextFor(null, {})).toBeNull();
  });
});

describe('[WTR-006] [NTF-005] what reaches the pager and the waiter app', () => {
  const alert = (channels: readonly string[], escalatedTo: readonly string[] = []) => ({
    recipientIds: ['ravi', 'vikram'],
    channels,
    escalatedTo,
  });

  it('shows a recipient every alert whose rule names the pager or the app', () => {
    expect(reachesPagerAndApp(alert(['PAGER', 'WAITER_APP', 'POS']), 'ravi')).toBe(true);
    expect(reachesPagerAndApp(alert(['PAGER']), 'ravi')).toBe(true);
    expect(reachesPagerAndApp(alert(['WAITER_APP']), 'ravi')).toBe(true);
    expect(reachesPagerAndApp(alert(['PAGER']), 'sunita')).toBe(false);
  });

  it('keeps POS and dashboard alerts off pagers and phones, unless escalated to the person', () => {
    expect(reachesPagerAndApp(alert(['POS', 'DASHBOARD']), 'vikram')).toBe(false);
    expect(reachesPagerAndApp(alert(['POS', 'DASHBOARD'], ['vikram']), 'vikram')).toBe(true);
    expect(reachesPagerAndApp(alert(['POS', 'DASHBOARD'], ['vikram']), 'ravi')).toBe(false);
  });
});

describe('[MGR-008] [NTF-005] what asks for a person at the POS and the dashboard', () => {
  const alert = (channels: readonly string[], escalatedTo: readonly string[] = []) => ({
    recipientIds: ['neha', 'vikram'],
    channels,
    escalatedTo,
  });

  it('asks a recipient when the rule names the POS or the dashboard', () => {
    expect(reachesConsole(alert(['PAGER', 'WAITER_APP', 'POS']), 'neha')).toBe(true);
    expect(reachesConsole(alert(['DASHBOARD']), 'vikram')).toBe(true);
    expect(reachesConsole(alert(['POS']), 'sunita')).toBe(false);
  });

  it('keeps pager and phone alerts off the console, unless escalated to the person', () => {
    expect(reachesConsole(alert(['PAGER', 'WAITER_APP']), 'vikram')).toBe(false);
    expect(reachesConsole(alert(['PAGER', 'WAITER_APP'], ['vikram']), 'vikram')).toBe(true);
    expect(reachesConsole(alert(['PAGER', 'WAITER_APP'], ['vikram']), 'neha')).toBe(false);
  });
});

describe('[NTF-002] a manager’s rules', () => {
  it('offers the usual people and channels, and the special ones only where they belong', () => {
    expect(recipientChoices('ITEM_READY')).toEqual([
      'RESPONSIBLE_WAITER',
      'SECTION_WAITERS',
      'ALL_WAITERS',
      'MANAGERS_ON_DUTY',
      'OWNER',
    ]);
    // No cashier to send anything to (ADR-0023).
    expect(RECIPIENT_KINDS).not.toContain('CASHIER');
    expect(recipientChoices('ORDER_CHANGED')).toContain('STATION');
    expect(recipientChoices('MANAGER_NUDGE')).toContain('SELECTED');
    expect(channelChoices('ITEM_READY')).toEqual([
      'PAGER',
      'WAITER_APP',
      'POS',
      'DASHBOARD',
      'TABLET',
    ]);
    expect(channelChoices('ORDER_CHANGED')).toContain('PRINTED_SLIP');
    expect(channelChoices('WATER_REQUEST')).not.toContain('KDS');
  });

  it('stores only what differs from Appendix C', () => {
    const factory = DEFAULT_NOTIFICATION_RULES.WATER_REQUEST;
    expect(ruleOverride('WATER_REQUEST', factory)).toBeUndefined();
    // The same people in another order is no change.
    expect(
      ruleOverride('BILL_REQUEST', {
        ...DEFAULT_NOTIFICATION_RULES.BILL_REQUEST,
        recipients: ['MANAGERS_ON_DUTY', 'RESPONSIBLE_WAITER'],
      }),
    ).toBeUndefined();
    expect(
      ruleOverride('WATER_REQUEST', {
        ...factory,
        recipients: ['SECTION_WAITERS'],
        escalate: false,
      }),
    ).toEqual({ recipients: ['SECTION_WAITERS'], escalate: false });
    const changed = effectiveRule('WATER_REQUEST', {
      WATER_REQUEST: { recipients: ['SECTION_WAITERS'], escalate: false },
    });
    expect(changed).toMatchObject({ recipients: ['SECTION_WAITERS'], channels: factory.channels });
  });

  it('needs someone, somewhere, and a pager line for the pager', () => {
    const factory = DEFAULT_NOTIFICATION_RULES.ITEM_READY;
    expect(checkRule(factory)).toEqual([]);
    expect(checkRule({ ...factory, recipients: [], channels: [] })).toEqual([
      'RECIPIENTS_REQUIRED',
      'CHANNELS_REQUIRED',
    ]);
    expect(checkRule({ ...factory, pagerText: ' ' })).toEqual(['PAGER_TEXT_REQUIRED']);
    expect(checkRule({ ...factory, pagerText: '{table} FOOD IS READY AT THE PASS' })).toEqual([
      'PAGER_TEXT_TOO_LONG',
    ]);
    expect(checkRule({ ...factory, channels: ['WAITER_APP'], pagerText: null })).toEqual([]);
  });
});
