import { Injectable } from '@nestjs/common';
import type { BillCustomerRequest, BillView, DiscountRequest } from '@rp/contracts';

/** A discount request after validation, defaults applied. */
export type ParsedDiscount = ReturnType<typeof DiscountRequest.parse>;
import {
  decideDiscount,
  type DiscountValue,
  effectiveDiscountRateBp,
  isBillable,
  normaliseGstin,
} from '@rp/domain';
import { AuditService } from '../audit/audit.service.js';
import { authErrors } from '../auth/auth-errors.js';
import { AuthService } from '../auth/auth.service.js';
import type { Principal } from '../auth/principal.js';
import { currentBusinessDate, dbDate } from '../common/business-dates.js';
import { newId } from '../common/ids.js';
import { PrismaService, type TransactionClient } from '../database/prisma.service.js';
import { AppError } from '../errors/app-error.js';
import type { Bill } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  type ActiveDiscount,
  type BillableItem,
  type BillSettings,
  type CalculatedBill,
  calculateBill,
  describeItem,
  isComplimentary,
} from './bill-calculation.js';

type Client = PrismaService | TransactionClient;

/** Everything a bill is priced from, loaded in one place. */
export interface BillContext {
  readonly bill: Bill;
  readonly tableId: string | null;
  readonly tableLabel: string | null;
  /** Whether the bill's table session is still open (its guests are still at the table). */
  readonly sessionOpen: boolean;
  readonly items: readonly BillableItem[];
  /** Items still waiting for a manager's approval (TAB/QR orders), which block printing. */
  readonly awaitingApproval: number;
  /** Items held back from the kitchen (ORD-016): fire or cancel them before the invoice. */
  readonly held: number;
  readonly discounts: readonly (ActiveDiscount & {
    reason: string;
    appliedById: string;
    approvedById: string | null;
  })[];
  readonly settings: BillSettings & {
    readonly serviceChargeEnabled: boolean;
    readonly rateBp: number;
    /** BILL-001: show the total in words. */
    readonly amountInWords: boolean;
  };
  readonly taxGroups: ReadonlyMap<string, { name: string; sacCode: string | null }>;
  readonly calculated: CalculatedBill;
}

function billNotFound(): AppError {
  return new AppError(404, 'BILL_NOT_FOUND', 'There is no such bill.');
}

function billPrinted(): AppError {
  return new AppError(
    409,
    'BILL_ALREADY_PRINTED',
    'This bill is printed. Edit the printed bill instead (manager PIN needed).',
  );
}

/**
 * Bills before printing (P1-10a, BILL-001, BILL-005, BILL-006, BILL-011). A bill belongs to one
 * table session or one takeaway order and is priced on the server from the items as ordered,
 * never from anything a client sends (ORD-014). Discounts, the service charge choice and the
 * customer's details are kept on it until the invoice is issued. Every change runs under a row
 * lock on the bill and is audited (AUD-001).
 */
@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
  ) {}

  /** Opens the bill of a table session or takeaway order, or returns the one already open. */
  async open(
    principal: Principal,
    target: { tableSessionId?: string | undefined; orderId?: string | undefined },
  ): Promise<BillView> {
    const billId = await this.prisma.transaction(async (tx) => {
      if (target.tableSessionId !== undefined) {
        // The table is locked first (as printing does), so two tills opening the same bill at
        // once get the one bill instead of a clash on its key (QA-012).
        const where = await tx.tableSession.findFirst({
          where: { id: target.tableSessionId, restaurantId: principal.restaurantId },
          select: { tableId: true },
        });
        if (where !== null) {
          await tx.$queryRaw`SELECT 1 AS locked FROM tables WHERE id = ${where.tableId}::uuid FOR UPDATE`;
        }
        const session = await tx.tableSession.findFirst({
          where: { id: target.tableSessionId, restaurantId: principal.restaurantId },
          select: { id: true, status: true, bill: { select: { id: true } } },
        });
        if (session === null) {
          throw new AppError(404, 'SESSION_NOT_FOUND', 'There is no such table session.');
        }
        if (session.bill !== null) return session.bill.id;
        if (session.status !== 'OPEN') {
          throw new AppError(404, 'SESSION_NOT_FOUND', 'This table session is closed.');
        }
        return this.create(tx, principal, { tableSessionId: session.id });
      }
      if (target.orderId !== undefined) {
        await tx.$queryRaw`SELECT 1 AS locked FROM orders WHERE id = ${target.orderId}::uuid FOR UPDATE`;
      }
      const order = await tx.order.findFirst({
        where: { id: target.orderId ?? '', restaurantId: principal.restaurantId },
        select: { id: true, orderType: true, bill: { select: { id: true } } },
      });
      if (order?.orderType !== 'TAKEAWAY') {
        throw new AppError(
          404,
          'ORDER_NOT_FOUND',
          'There is no such takeaway order. Dine-in orders are billed by table.',
        );
      }
      if (order.bill !== null) return order.bill.id;
      return this.create(tx, principal, { orderId: order.id });
    });
    return this.view(principal.restaurantId, billId);
  }

  async view(restaurantId: string, billId: string): Promise<BillView> {
    const [context, invoices] = await Promise.all([
      this.context(this.prisma, restaurantId, billId),
      this.prisma.invoice.findMany({
        where: { billId, restaurantId },
        select: { id: true },
        orderBy: { issuedAt: 'asc' },
      }),
    ]);
    return this.toView(
      context,
      invoices.map((invoice) => invoice.id),
      context.bill.status === 'INVOICED'
        ? await this.unbilledIds(this.prisma, restaurantId, billId, context.items)
        : [],
      await this.voidedPartIds(this.prisma, restaurantId, billId),
    );
  }

  /**
   * The bill's dishes that no live printed invoice has yet: ordered after the bill was printed
   * (QA-022). A split takes every line whole, so a dish is either on a live invoice or not.
   */
  async unbilledIds(
    client: Client,
    restaurantId: string,
    billId: string,
    items: readonly BillableItem[],
  ): Promise<string[]> {
    const invoiced = await client.invoiceLine.findMany({
      where: {
        restaurantId,
        orderItemId: { in: items.map((item) => item.id) },
        invoice: { billId, status: { not: 'VOIDED' } },
      },
      select: { orderItemId: true },
    });
    const done = new Set(invoiced.map((line) => line.orderItemId));
    return items.filter((item) => !done.has(item.id)).map((item) => item.id);
  }

  /** Voided parts of a printed (split) bill that were not printed again, oldest first (QA-026). */
  async voidedPartIds(client: Client, restaurantId: string, billId: string): Promise<string[]> {
    const voided = await client.invoice.findMany({
      where: {
        restaurantId,
        billId,
        status: 'VOIDED',
        replacedBy: { none: {} },
        bill: { status: 'INVOICED' },
      },
      orderBy: [{ voidedAt: 'asc' }, { sequence: 'asc' }],
      select: { id: true },
    });
    return voided.map((invoice) => invoice.id);
  }

  /**
   * Locks a bill to print (as `lockedOpenBill`) and says what printing does now. An open bill is
   * printed as before. A printed bill with dishes ordered since (QA-022) is printed again: its one
   * printed invoice is revised in place while nobody has paid any of it; otherwise (paid, part
   * paid or split) a new invoice takes just the new dishes. Anything else is already printed.
   */
  async lockedBillToPrint(
    tx: TransactionClient,
    restaurantId: string,
    billId: string,
  ): Promise<
    | { readonly mode: 'OPEN'; readonly context: BillContext }
    | { readonly mode: 'REVISE'; readonly context: BillContext; readonly invoiceId: string }
    | { readonly mode: 'MORE'; readonly context: BillContext }
    | { readonly mode: 'REPLACE_PART'; readonly context: BillContext; readonly voidedId: string }
  > {
    const found = await tx.bill.findFirst({
      where: { id: billId, restaurantId },
      select: { status: true },
    });
    if (found === null) throw billNotFound();
    if (found.status === 'OPEN') {
      return { mode: 'OPEN', context: await this.lockedOpenBill(tx, restaurantId, billId) };
    }
    await this.lockBill(tx, restaurantId, billId);
    const context = await this.context(tx, restaurantId, billId);
    if (context.bill.status === 'OPEN') return { mode: 'OPEN', context };
    // A voided part of a split bill, other parts still standing: printed again as it was, under a
    // new number (QA-026).
    const voided = await this.voidedPartIds(tx, restaurantId, billId);
    if (voided[0] !== undefined) return { mode: 'REPLACE_PART', context, voidedId: voided[0] };
    const unbilled = await this.unbilledIds(tx, restaurantId, billId, context.items);
    if (unbilled.length === 0) throw billPrinted();
    const live = await tx.invoice.findMany({
      where: { billId, status: { not: 'VOIDED' } },
      select: {
        id: true,
        status: true,
        _count: { select: { payments: { where: { status: 'CAPTURED' } } } },
      },
    });
    const only = live.length === 1 ? live[0] : undefined;
    if (only?.status === 'ISSUED' && only._count.payments === 0) {
      return { mode: 'REVISE', context, invoiceId: only.id };
    }
    return {
      mode: 'MORE',
      context: await this.context(tx, restaurantId, billId, new Set(unbilled)),
    };
  }

  /** An item or bill discount, within the role's limit or with a manager's approval (BILL-005). */
  async addDiscount(
    principal: Principal,
    billId: string,
    request: ParsedDiscount,
    overrideToken: string | undefined,
  ): Promise<BillView> {
    await this.prisma.transaction(async (tx) => {
      const context = await this.lockedOpenBill(tx, principal.restaurantId, billId);
      const { result } = context.calculated;
      let base: number;
      if (request.orderItemId !== null) {
        const line = result.lines.find((candidate) => candidate.id === request.orderItemId);
        if (line === undefined) {
          throw new AppError(404, 'BILL_LINE_NOT_FOUND', 'That item is not on this bill.');
        }
        if (context.calculated.itemDiscountOf.has(line.id)) {
          throw new AppError(
            409,
            'DISCOUNT_EXISTS',
            'This item already has a discount. Take it back first to give another.',
          );
        }
        base = line.grossAmount;
      } else {
        if (context.calculated.billDiscount !== null) {
          throw new AppError(
            409,
            'DISCOUNT_EXISTS',
            'This bill already has a bill discount. Take it back first to give another.',
          );
        }
        base = result.subtotal - result.itemDiscountTotal;
      }
      if (base === 0) {
        throw new AppError(409, 'NOTHING_TO_DISCOUNT', 'There is nothing left to discount.');
      }
      const value: DiscountValue =
        request.kind === 'PERCENT'
          ? { kind: 'PERCENT', rateBp: request.rateBp ?? 0 }
          : { kind: 'FLAT', amount: request.amount ?? 0 };
      if (value.kind === 'FLAT' && value.amount > base) {
        throw new AppError(
          422,
          'DISCOUNT_EXCEEDS_AMOUNT',
          'A flat discount cannot be more than what it applies to.',
          { base },
        );
      }
      const rateBp = effectiveDiscountRateBp(base, value);
      const approverId = await this.approve(principal, billId, rateBp, overrideToken);

      const discount = await tx.discount.create({
        data: {
          id: newId(),
          restaurantId: principal.restaurantId,
          businessDate: context.bill.businessDate,
          billId,
          orderItemId: request.orderItemId,
          kind: request.kind,
          rateBp: request.rateBp,
          // A flat discount's amount is what was given; a percentage's is worked out below.
          amount: value.kind === 'FLAT' ? value.amount : 0,
          reason: request.reason,
          appliedById: principal.staffId,
          approvedById: approverId,
        },
      });
      // Record what it takes off now; the invoice records the final amount.
      const after = await this.context(tx, principal.restaurantId, billId);
      const amount = this.discountAmount(after, discount.id);
      await tx.discount.update({ where: { id: discount.id }, data: { amount } });
      await this.audit.record(tx, {
        action: isComplimentary({ ...discount, amount })
          ? 'ITEM_COMPLIMENTARY'
          : 'DISCOUNT_APPLIED',
        entityType: 'bill',
        entityId: billId,
        actorId: principal.staffId,
        approverId,
        deviceId: principal.deviceId,
        restaurantId: principal.restaurantId,
        before: { grandTotal: result.grandTotal },
        after: {
          discountId: discount.id,
          orderItemId: request.orderItemId,
          kind: request.kind,
          rateBp: request.rateBp,
          amount,
          effectiveRateBp: rateBp,
          grandTotal: after.calculated.result.grandTotal,
        },
        reason: request.reason,
      });
    });
    return this.view(principal.restaurantId, billId);
  }

  async revokeDiscount(
    principal: Principal,
    billId: string,
    discountId: string,
    reason: string,
  ): Promise<BillView> {
    await this.prisma.transaction(async (tx) => {
      const context = await this.lockedOpenBill(tx, principal.restaurantId, billId);
      const discount = context.discounts.find((candidate) => candidate.id === discountId);
      if (discount === undefined) {
        throw new AppError(404, 'DISCOUNT_NOT_FOUND', 'There is no such discount on this bill.');
      }
      await tx.discount.update({
        where: { id: discountId },
        data: { revokedAt: new Date(), revokedById: principal.staffId },
      });
      const after = await this.context(tx, principal.restaurantId, billId);
      await this.audit.record(tx, {
        action: 'DISCOUNT_REVOKED',
        entityType: 'bill',
        entityId: billId,
        actorId: principal.staffId,
        deviceId: principal.deviceId,
        restaurantId: principal.restaurantId,
        before: {
          discountId,
          amount: discount.amount,
          grandTotal: context.calculated.result.grandTotal,
        },
        after: { grandTotal: after.calculated.result.grandTotal },
        reason,
      });
    });
    return this.view(principal.restaurantId, billId);
  }

  /** Removes the voluntary service charge at the diner's request, or puts it back (BILL-006). */
  async setServiceCharge(
    principal: Principal,
    billId: string,
    removed: boolean,
    reason: string,
  ): Promise<BillView> {
    await this.prisma.transaction(async (tx) => {
      const context = await this.lockedOpenBill(tx, principal.restaurantId, billId);
      if (context.bill.serviceChargeRemoved === removed) return;
      await tx.bill.update({ where: { id: billId }, data: { serviceChargeRemoved: removed } });
      await this.audit.record(tx, {
        action: removed ? 'SERVICE_CHARGE_REMOVED' : 'SERVICE_CHARGE_RESTORED',
        entityType: 'bill',
        entityId: billId,
        actorId: principal.staffId,
        deviceId: principal.deviceId,
        restaurantId: principal.restaurantId,
        before: {
          serviceChargeRemoved: !removed,
          serviceCharge: context.calculated.result.serviceCharge,
        },
        after: { serviceChargeRemoved: removed },
        reason,
      });
    });
    return this.view(principal.restaurantId, billId);
  }

  /** The customer's details for the invoice (BILL-011); the phone is kept only with consent. */
  async setCustomer(
    principal: Principal,
    billId: string,
    customer: BillCustomerRequest,
  ): Promise<BillView> {
    await this.prisma.transaction(async (tx) => {
      await this.lockedOpenBill(tx, principal.restaurantId, billId);
      await tx.bill.update({
        where: { id: billId },
        data: {
          customerName: customer.name,
          customerPhone: customer.phoneConsent ? customer.phone : null,
          customerPhoneConsent: customer.phone !== null && customer.phoneConsent,
          customerGstin: customer.gstin === null ? null : normaliseGstin(customer.gstin),
        },
      });
    });
    return this.view(principal.restaurantId, billId);
  }

  /** Locks the bill row (and the table, for dine-in) and checks it can still change. */
  async lockedOpenBill(
    tx: TransactionClient,
    restaurantId: string,
    billId: string,
  ): Promise<BillContext> {
    await this.lockBill(tx, restaurantId, billId);
    const context = await this.context(tx, restaurantId, billId);
    if (context.bill.status !== 'OPEN') throw billPrinted();
    return context;
  }

  /** Locks a bill's table (dine-in) and then the bill. */
  private async lockBill(tx: TransactionClient, restaurantId: string, billId: string) {
    const found = await tx.bill.findFirst({
      where: { id: billId, restaurantId },
      select: { tableSession: { select: { tableId: true } } },
    });
    if (found === null) throw billNotFound();
    // Tables before bills, the order order submission and table moves use.
    if (found.tableSession !== null) {
      await tx.$queryRaw`SELECT 1 AS locked FROM tables WHERE id = ${found.tableSession.tableId}::uuid FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT 1 AS locked FROM bills WHERE id = ${billId}::uuid FOR UPDATE`;
  }

  /**
   * Loads and prices a bill; with `only`, just those dishes and none of the bill's discounts on
   * the whole bill (a further bill for dishes ordered after the first was printed, QA-022).
   */
  async context(
    client: Client,
    restaurantId: string,
    billId: string,
    only?: ReadonlySet<string>,
  ): Promise<BillContext> {
    const bill = await client.bill.findFirst({
      where: { id: billId, restaurantId },
      include: {
        tableSession: { include: { table: { select: { id: true, label: true } } } },
        discounts: { where: { revokedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (bill === null) throw billNotFound();
    const orderFilter =
      bill.tableSessionId !== null
        ? { tableSessionId: bill.tableSessionId }
        : { id: bill.orderId ?? '' };
    const [orderItems, snapshot] = await Promise.all([
      client.orderItem.findMany({
        where: { restaurantId, parentOrderItemId: null, order: orderFilter },
        include: { modifiers: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.settings.snapshot(restaurantId),
    ]);
    const billable = orderItems.filter(
      (item) => isBillable(item.state) && (only === undefined || only.has(item.id)),
    );
    const taxGroupRows = await client.taxGroup.findMany({
      where: { id: { in: [...new Set(billable.map((item) => item.taxGroupId))] } },
      select: { id: true, name: true, sacCode: true },
    });
    const taxGroups = new Map(
      taxGroupRows.map((group) => [group.id, { name: group.name, sacCode: group.sacCode }]),
    );
    const serviceChargeEnabled = snapshot.get('billing.serviceChargeEnabled');
    const rateBp = snapshot.get('billing.serviceChargeRateBp');
    const settings = {
      priceMode: snapshot.get('billing.priceMode'),
      roundingUnitPaise: snapshot.get('billing.roundingUnitPaise'),
      // Dine-in only: a takeaway guest was not served at the table (PROGRESS decision 43).
      serviceChargeRateBp:
        serviceChargeEnabled && !bill.serviceChargeRemoved && bill.tableSessionId !== null
          ? rateBp
          : null,
      serviceChargeEnabled,
      rateBp,
      amountInWords: snapshot.get('bills.amountInWords'),
    };
    const items: BillableItem[] = billable.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      name: item.name,
      variantName: item.variantName,
      modifiers: item.modifiers.map(({ name, quantity }) => ({ name, quantity })),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxGroupId: item.taxGroupId,
      taxRates: item.taxRates,
    }));
    // A discount on an item no longer on the bill (cancelled) takes nothing off.
    const billableIds = new Set(items.map((item) => item.id));
    const discounts = bill.discounts
      .filter((discount) =>
        discount.orderItemId === null ? only === undefined : billableIds.has(discount.orderItemId),
      )
      .map((discount) => ({
        id: discount.id,
        orderItemId: discount.orderItemId,
        kind: discount.kind,
        rateBp: discount.rateBp,
        amount: discount.amount,
        reason: discount.reason,
        appliedById: discount.appliedById,
        approvedById: discount.approvedById,
      }));
    const calculated = calculateBill(
      items,
      discounts,
      new Map([...taxGroups].map(([id, group]) => [id, group.name])),
      settings,
    );
    return {
      bill,
      tableId: bill.tableSession?.table.id ?? null,
      sessionOpen: bill.tableSession?.status === 'OPEN',
      tableLabel: bill.tableSession?.table.label ?? null,
      items,
      awaitingApproval: orderItems.filter((item) => item.state === 'PENDING_APPROVAL').length,
      held: orderItems.filter((item) => item.state === 'HELD' && item.parentOrderItemId === null)
        .length,
      discounts,
      settings,
      taxGroups,
      calculated,
    };
  }

  /** What a discount takes off in this calculation. */
  discountAmount(context: BillContext, discountId: string): number {
    const discount = context.discounts.find((candidate) => candidate.id === discountId);
    if (discount === undefined) return 0;
    const { result } = context.calculated;
    if (discount.orderItemId === null) return result.billDiscountTotal;
    return result.lines.find((line) => line.id === discount.orderItemId)?.itemDiscount ?? 0;
  }

  toView(
    context: BillContext,
    invoiceIds: readonly string[] = [],
    unbilledOrderItemIds: readonly string[] = [],
    voidedPartIds: readonly string[] = [],
  ): BillView {
    const { bill, calculated, settings } = context;
    const { result } = calculated;
    const itemsById = new Map(context.items.map((item) => [item.id, item]));
    return {
      id: bill.id,
      status: bill.status,
      tableSessionId: bill.tableSessionId,
      orderId: bill.orderId,
      tableLabel: context.tableLabel,
      priceMode: result.priceMode,
      lines: result.lines.map((line) => {
        const item = itemsById.get(line.id);
        return {
          orderItemId: line.id,
          description: item === undefined ? '' : describeItem(item),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          grossAmount: line.grossAmount,
          itemDiscount: line.itemDiscount,
          billDiscountShare: line.billDiscountShare,
          netAmount: line.netAmount,
          taxGroupId: calculated.groupIdOf.get(line.taxGroupId) ?? line.taxGroupId,
          complimentary: isComplimentary(calculated.itemDiscountOf.get(line.id)),
        };
      }),
      discounts: context.discounts.map((discount) => ({
        id: discount.id,
        orderItemId: discount.orderItemId,
        kind: discount.kind,
        rateBp: discount.rateBp,
        amount: this.discountAmount(context, discount.id),
        reason: discount.reason,
        appliedById: discount.appliedById,
        approvedById: discount.approvedById,
      })),
      serviceCharge: {
        enabled: settings.serviceChargeEnabled,
        removed: bill.serviceChargeRemoved,
        rateBp: settings.rateBp,
        amount: result.serviceCharge,
      },
      subtotal: result.subtotal,
      discountTotal: result.discountTotal,
      taxableValueTotal: result.taxableValueTotal,
      taxLines: result.taxLines.map((line) => ({
        taxGroupId: calculated.groupIdOf.get(line.taxGroupId) ?? line.taxGroupId,
        name: line.taxGroupName,
        source: line.source,
        taxableValue: line.taxableValue,
        components: line.components.map(({ code, rateBp, amount }) => ({ code, rateBp, amount })),
        taxTotal: line.taxTotal,
      })),
      taxTotal: result.taxTotal,
      roundOff: result.roundOff,
      grandTotal: result.grandTotal,
      customer: {
        name: bill.customerName,
        phone: bill.customerPhone,
        phoneConsent: bill.customerPhoneConsent,
        gstin: bill.customerGstin,
      },
      invoiceIds: [...invoiceIds],
      unbilledOrderItemIds: [...unbilledOrderItemIds],
      voidedPartIds: [...voidedPartIds],
      editingInvoiceId: bill.editingInvoiceId,
      amountInWords: settings.amountInWords,
    };
  }

  private async create(
    tx: TransactionClient,
    principal: Principal,
    target: { tableSessionId?: string; orderId?: string },
  ): Promise<string> {
    const businessDate = await currentBusinessDate(tx, principal.restaurantId);
    // P9-02, BILL-011: the number the diner gave on the QR page, which said it is printed on the
    // bill, goes on the table's bill; the latest one, if several diners gave one.
    const fromQr =
      target.tableSessionId === undefined
        ? null
        : await tx.order.findFirst({
            where: {
              restaurantId: principal.restaurantId,
              tableSessionId: target.tableSessionId,
              source: 'QR',
              customerPhone: { not: null },
            },
            orderBy: { createdAt: 'desc' },
            select: { customerPhone: true, customerName: true },
          });
    const bill = await tx.bill.create({
      data: {
        id: newId(),
        restaurantId: principal.restaurantId,
        businessDate: dbDate(businessDate),
        tableSessionId: target.tableSessionId ?? null,
        orderId: target.orderId ?? null,
        ...(fromQr !== null && {
          customerPhone: fromQr.customerPhone,
          customerPhoneConsent: true,
          customerName: fromQr.customerName,
        }),
      },
    });
    return bill.id;
  }

  /**
   * BILL-005: Owner and Manager may give any discount; a custom role allowed discounts within the
   * limit up to `billing.discountLimitBp`, and above it or complimentary with a manager's override
   * token for DISCOUNT_ABOVE_LIMIT. Returns the approver, if one was needed.
   */
  private async approve(
    principal: Principal,
    billId: string,
    rateBp: number,
    overrideToken: string | undefined,
  ): Promise<string | null> {
    const snapshot = await this.settings.snapshot(principal.restaurantId);
    const decision = decideDiscount(
      { role: principal.role, extraCapabilities: principal.capabilities },
      rateBp,
      snapshot.get('billing.discountLimitBp'),
    );
    if (decision === 'ALLOWED') return null;
    if (decision === 'DENIED') throw authErrors.forbidden();
    if (overrideToken === undefined || overrideToken === '') {
      throw authErrors.overrideRequired('DISCOUNT_ABOVE_LIMIT');
    }
    // An approval is for one bill only; on another it is refused and not spent (PC-T2).
    const override = await this.auth.consumeOverride(
      principal,
      'DISCOUNT_ABOVE_LIMIT',
      overrideToken,
      { entityType: 'bill', entityId: billId },
    );
    if (override === null) throw authErrors.overrideInvalid();
    return override.approverId;
  }
}
