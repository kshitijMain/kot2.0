import type { RecipientContext } from '@rp/domain';
import type { TransactionClient } from '../database/prisma.service.js';

export interface RecipientSubject {
  readonly restaurantId: string;
  readonly businessDate: string;
  readonly tableId: string | null;
  readonly tableSessionId: string | null;
  readonly selectedIds?: readonly string[];
  readonly wearerId?: string | null;
  /** The person whose own request it is (a waiter asking for the bill): not alerted (P2-06d). */
  readonly askedById?: string | null;
  /** Who sent the KOT the alert is about (ADR-0023). */
  readonly kotSenderId?: string | null;
}

/**
 * The people a rule can name, as the restaurant is now (P2-03):
 * - every waiter: any waiter serves any table (ADR-0023), and those on duty are alerted;
 * - managers on duty: Owner and managers signed in on a device now, else every active manager;
 * - the Owner;
 * - the KOT's sender, who is on duty while signed in or while their pager or phone is connected
 *   (ADR-0023, D-17).
 */
export async function recipientContext(
  tx: TransactionClient,
  subject: RecipientSubject,
  now: Date,
  reachable: (staffId: string) => boolean,
): Promise<RecipientContext> {
  const { restaurantId } = subject;
  const [staff, signedIn] = await Promise.all([
    tx.staff.findMany({
      where: { restaurantId, active: true, archivedAt: null },
      select: { id: true, onBreakSince: true, role: { select: { baseRole: true } } },
    }),
    tx.session.findMany({
      where: { restaurantId, revokedAt: null, expiresAt: { gt: now } },
      select: { staffId: true },
    }),
  ]);
  const byRole = (roles: readonly string[]) =>
    staff.filter((person) => roles.includes(person.role.baseRole)).map((person) => person.id);
  const online = new Set(signedIn.map((entry) => entry.staffId));
  const managers = byRole(['OWNER', 'MANAGER']);
  const onDuty = (ids: readonly string[], preferred: ReadonlySet<string>) => {
    const present = ids.filter((id) => preferred.has(id));
    return present.length > 0 ? present : [...ids];
  };
  return {
    allWaiterIds: byRole(['WAITER']),
    kotSenderId: subject.kotSenderId ?? null,
    onDuty: (staffId) => online.has(staffId) || reachable(staffId),
    managersOnDuty: onDuty(managers, online),
    ownerIds: byRole(['OWNER']),
    selectedIds: subject.selectedIds ?? [],
    wearerId: subject.wearerId ?? null,
    askedById: subject.askedById ?? null,
    onBreak: new Set(
      staff.filter((person) => person.onBreakSince !== null).map((person) => person.id),
    ),
    reachable,
  };
}
