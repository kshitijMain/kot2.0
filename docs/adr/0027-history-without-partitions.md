# ADR-0027: History without partitions: daily summaries and indexes

Status: Accepted
Date: 2026-11-01
Work package: P9-27
Requirements: DATA-008, DATA-009, DATA-012, RPT-001, RPT-002, RPT-005, RPT-006, RPT-018, BILL-003, AUD-003, AUD-004

## Context

The Business Owner approved four tiers of data (P9-27): live and today's data on the devices
(tiers 0 and 1), history on the PC only (tier 2), and whole financial years in their archive
(tier 3, P7-06b). Tier 2 has to stay quick for years: "a month ago" should open at once however
old the database is, and the Owner must be able to look up an old bill.

The obvious tool is PostgreSQL's declarative partitioning: `orders`, `invoices`, `payments`, `kots`
and `audit_log` split by month of `business_date`, so a report of one month reads one partition and
an old month can be detached. We checked what that would take on this schema.

- **Every primary key and unique constraint must contain the partition key.** Today:
  - `invoices` has `UNIQUE (restaurant_id, invoice_number)` and
    `UNIQUE (series_id, financial_year, sequence)`. They are what makes an invoice number never be
    used twice (BILL-003, a GST rule). Partitioned by date, PostgreSQL could only enforce them
    within a month; a number reused in another month would no longer be refused by the database.
  - `audit_log` has `UNIQUE (chain_seq)`, the order of the hash chain (AUD-003). The same problem:
    uniqueness per month only.
  - Every `id` primary key would become `(id, business_date)`.
- **Every foreign key to a partitioned table must carry the partition key.** Seven tables point at
  `orders` (approvals, bills, invoices, kots, order_events, order_items, relay_orders), six at
  `invoices` (digital_bills, discounts, invoice_lines, payments, tax_lines, and invoices itself for
  re-issues) and two at `kots` (alerts, kot_lines). Each would need a `business_date` column copied
  from its parent, kept equal to it, and a two-column foreign key. A record dated by one rule (an
  item added after the cut-off, a payment taken the next morning, P7-06b) would have to carry its
  parent's date instead of its own.
- **The migration** would rewrite the five tables and the fifteen that point at them on every
  installed PC during an update, with the service stopped, and
  Prisma cannot describe partitioned tables: every later schema change to them would be hand-made
  SQL that `prisma migrate diff` (checked in `database.int.test.ts`) cannot verify.
- **The volume does not call for it.** Five years at design capacity (2,000 orders a day) come to
  about 50 GB, half the 100 GB target (`docs/build/data-volume.md`); the largest table, the audit
  log, is about 7 GB after five years. That is a size PostgreSQL serves well from B-tree indexes.
  Partitioning pays off on tables many times larger, or where old data is dropped month by month;
  here it leaves a whole financial year at a time, by the Owner, through archive-then-purge.

## Decision

No partitioning. Tier 2 history is made quick with summaries and indexes instead:

1. **Daily summary tables** (migration `20261101140000_daily_summaries`): when day-end closes a
   business date it sums it, in the same transaction, into `daily_sales_hours` (sales by hour),
   `daily_item_sales` (by dish; categories are joined when read, as the live report does),
   `daily_payment_modes` (by mode) and `daily_staff_sales` (orders taken, bills issued and their
   value, sales of the dishes each person ordered); `daily_summaries` lists the dates summed.
   Amounts are integer paise.
2. **Reports merge them with live data.** The sales, item, category and payment-mode reports
   read the summaries for summed dates and the live tables only for the rest (today, a date not
   closed, or one changed since), with the same SQL the summaries were built with
   (`apps/server/src/reports/daily-figures.ts`), so the figures are identical either way
   (`daily-summaries.int.test.ts` compares the two). A year of a closed restaurant reads about
   6,000 hour rows instead of 730,000 invoices.
3. **Summaries stay true.** A change that still reaches a summed date (an edited bill of a table
   carried forward, an old bill voided) fires a trigger on `invoices` or `payments` that marks the
   date stale; the reports read it live until the server sums it again (every 15 minutes, and on
   start for the days closed before summaries existed: the backfill). The trigger shares day-end's
   lock and building a summary holds it alone, so no change is ever missed.
4. **Indexes** for history: invoices by `(restaurant_id, business_date, issued_at, id)` (the bill
   history pages newest first straight from it, and every report by date uses its prefix), by
   `(restaurant_id, sequence)` (a running number in any series or year) and by the last ten digits
   of the guest's phone (a partial expression index); the audit log by
   `(restaurant_id, occurred_at)`. Orders, order items, KOTs and payments already lead with
   `(restaurant_id, business_date)`.
5. **Old years** keep leaving as whole financial years through archive-then-purge (P7-06b), which
   detaches old data from the live tables without partitions. The summaries are kept when a year
   is archived: they hold no personal data, and the reports keep showing the year's totals.

## Alternatives considered

- **Monthly partitions on `business_date`.** Rejected for the reasons above: the invoice-number and
  audit-chain uniqueness the law and AUD-003 rely on would be enforceable only per month, fifteen
  foreign keys would have to be widened, five large tables rewritten on every PC, and Prisma
  could no longer check the schema, for a database a fifth of the size where partitioning helps.
- **Partitioning only `audit_log`.** Nothing references it, but its `chain_seq` must stay unique
  across the whole chain, and it is purged a year at a time already.
- **Materialised views refreshed at day-end.** A refresh recomputes every date, not one; and
  PostgreSQL cannot refresh one date's rows, or mark one stale, which the summaries do.
- **Summing in the client or a cache in memory.** Lost at every restart, not shared between the
  reports, and no help to "a month ago" on the first visit.

## Consequences

- Reports of past periods read a few rows per day; only the open date (and any date marked
  stale) is summed from the live tables.
- Day-end does a little more work in its transaction (four grouped queries over one day).
- Every insert or relevant update of an invoice or payment runs a small trigger: one index lookup
  on `daily_summaries`, nothing written unless the date was summed.
- The summaries are derived data: the server's role may delete and rewrite them. A summary can be
  rebuilt at any time from the live tables (`DailySummariesService.refresh`).
- Two caveats, both accepted: hours are summed in the restaurant's time zone at the time the date
  is summed, and a dish is counted once per date when its equal split parts share that date (they
  always do; parts are issued together).
- **Revisit** if a restaurant's measured volume passes about 200 GB, if a single table's index no
  longer fits in memory on the PC we ship, or if old data must leave month by month rather than a
  year at a time. A move would start with `audit_log` (no foreign keys to it) and would need the
  invoice-number and chain uniqueness enforced another way (a separate numbering table).
