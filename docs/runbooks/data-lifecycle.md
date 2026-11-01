# Data lifecycle

How long the restaurant PC keeps each kind of data (BRD §9.3), and how it is removed: the
automatic retention (P7-06a) and archive-then-purge of business records (DATA-008, P7-06b).

## The four tiers (P9-27)

| Tier | What                           | Where                               | Read by                                               |
| ---- | ------------------------------ | ----------------------------------- | ----------------------------------------------------- |
| 0    | Live: open tables, orders, KDS | The PC, pushed to the devices       | Every device                                          |
| 1    | Today: the open business date  | The PC; devices keep only today     | Every device, and the reports (from the live tables)  |
| 2    | History: every closed date     | The PC only, summed and paged       | The console's Reports and History, Owner and managers |
| 3    | Archive: whole financial years | `.rpar` files, the cloud (DATA-008) | The archive viewer (DATA-009)                         |

Phones and tablets never hold more than live and today's data. History stays on the PC and is read
there, either summed (the reports) or a page at a time (the bill history), so a month ago opens at
once however many years are kept. Old years leave as whole financial years (below).

### Daily summaries (tier 2)

When day-end closes a business date it sums the date, in the same transaction, into the daily
summary tables (ADR-0027):

| Table                 | One row per date and            | Figures                                                           |
| --------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `daily_sales_hours`   | hour of issue (restaurant time) | invoices, gross, discounts, service charge, tax, round-off, net   |
| `daily_item_sales`    | dish                            | quantity, gross, discounts, net, tax (category joined when read)  |
| `daily_payment_modes` | payment mode (and its name)     | payments, amount                                                  |
| `daily_staff_sales`   | person                          | orders taken, bills issued and their value, sales of their dishes |
| `daily_summaries`     | (the date itself)               | when it was summed, and whether a later change made it stale      |

Amounts are integer paise; voided invoices count in none of them, as in the reports.

- **The reports** (sales, items, categories, payment modes) read the summaries for closed dates
  and the live tables only for the rest: the open date, a date never closed, or one marked stale.
  The two are built by the same queries, so the figures are the same either way.
- **A late change.** An invoice of a closed date can still change: a table carried forward is
  billed again after an edit, or an old bill is voided. A database trigger on `invoices` and
  `payments` then marks the date stale, and the reports read it live until it is summed again.
- **Summing again, and the backfill.** Thirty seconds after the server starts, then every 15
  minutes, the server sums every closed date that has no summary (the days closed before summaries
  existed) or a stale one, newest first, one date at a time. Nothing needs doing by hand; a summary
  can always be rebuilt from the live tables.
- **Archived years.** Archive-then-purge leaves the summaries in place: they hold no personal data,
  and the reports keep showing an archived year's totals. The year's bills are in its archive.

### The bill history (tier 2)

Reports, then History, then Bills (the Owner and managers): every bill still on the PC, newest
first, 50 at a time ("Show more"). Without a search it lists the period chosen above the reports;
a bill number (as printed, or only its running number, "123") or the guest's phone number (however
it was typed: its last ten digits are compared) searches all dates. A bill opens as printed and
can be printed again on the bill printer, marked duplicate. Indexes on invoices make each of these
quick: by business date and time of issue, by running number, and by the phone's last ten digits.

## What is kept, and for how long

| Data                                                         | Kept                                              | How it goes                                              |
| ------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------- |
| Orders, bills, invoices, payments, cash, day ends, audit log | At least the statutory period (72 months, §12)    | Only archive-then-purge, by the Owner (DATA-008)         |
| Alerts (cleared or acknowledged), closed service calls       | `retention.operationalDays` (90 days)             | Daily, automatically                                     |
| Kitchen print notices (printed or failed), idempotency keys  | 90 days                                           | Daily, automatically                                     |
| The server's log files (`<RP_DATA_DIR>\logs`)                | 90 days                                           | Daily, automatically                                     |
| Restore leftovers, downloaded cloud backups                  | A day (leftover folders), 90 days (downloads)     | Daily, automatically                                     |
| Event outbox and inbox                                       | Until every device has caught up                  | The event bus prunes them itself                         |
| Menu photos                                                  | While in use, then 90 days                        | The photo store prunes them itself                       |
| A diner's phone number and consent                           | `retention.dinerContactMonths` (24) after a visit | Anonymised daily; or erased on request (DATA-011)        |
| Feedback                                                     | Comments `retention.feedbackMonths` (24)          | The comment and the diner link are removed; ratings stay |

The settings are in Settings, "Keeping data" (the Owner only).

How much room it takes: five years at design capacity (2,000 orders a day) come to about 50 GB of
database, half the 100 GB sizing target (DATA-012, measured in `docs/build/data-volume.md`).

## The daily run (P7-06a)

Ten minutes after the server starts, then every day, the retention:

1. for each restaurant, in one transaction:
   - removes cleared or acknowledged alerts older than the operational period, except one a
     service call still points at;
   - removes closed service calls, printed or failed print notices and expired idempotency
     records older than it;
   - anonymises the phone number of each diner whose last visit (the consent, or their latest
     feedback) is older than `retention.dinerContactMonths`;
   - removes the comment and the diner link from feedback older than `retention.feedbackMonths`,
     keeping its ratings for the reports;
   - writes `RETENTION_APPLIED` to the audit log with the counts, when anything changed;
2. removes log files and downloaded cloud backups older than the operational period, and restore
   or recovery work folders older than a day.

The System page's "Data drive" section says when it last ran and how many items it removed.

The application's database role may delete only these operational rows. Orders, bills,
payments and the audit log stay protected from it (AUD-004).

## Archive-then-purge (P7-06b)

Orders, bills, invoices, payments, cash, shifts, day ends and the audit log never leave by
themselves. The Owner removes a whole financial year when the drive needs the room (DATA-008):
System, then "Old years", then "Archive 2023-24…". It needs the Owner and a reason.

- **Oldest first.** Only whole years that have ended, and only the oldest one still on the PC, so
  what stays is always one stretch of time and the audit chain keeps its tail.
- **The statutory warning.** GST law asks for a year's records 72 months from the due date of its
  annual return, 31 December after the year (§12): FY 2023-24 until 31-12-2030. While a year is
  within that period, the Owner must confirm the restaurant keeps the archive until then.
- **What a year holds.** Orders, invoices, bills and shifts by their business date; what hangs off
  them goes with them, whatever its own date (an item added after the cut-off, a payment taken
  the next morning, a cash movement late in the shift). The audit log goes from its start up to
  the year's last entry. Table sessions, staff and the menu stay.

What it does, in order:

1. Counts the year's rows, table by table.
2. Writes `rp-archive-FY<year>-<time>.rpar` into the chosen folder (the second backup location's
   `rp-archives\rp-archive-FY<year>` by default): every row as JSON lines, a description and a
   manifest of sizes and SHA-256, encrypted with the backup key like a backup (kind ARCHIVE).
3. Writes the human-readable export beside it: `invoice-register-FY<year>.csv` (one line per
   invoice, amounts in rupees, taxes by code) and `invoices\<month>\<date>.pdf`, every invoice of
   the day as printed.
4. Reads the archive back in full: every chunk, the manifest, and the row count of every table.
5. Deletes the year through the purge login, in one transaction: each table must lose exactly the
   rows archived, or nothing is deleted. The purge record (`archive_runs`, DONE, with the counts,
   the file's SHA-256 and the last audit entry archived) is written in the same transaction.
   `ARCHIVE_REQUESTED` and `BUSINESS_RECORDS_PURGED` go to the audit log.
6. Sends the archive to the cloud with the next nightly backup. The vendor keeps archived years
   for good (the backups' retention does not touch them) and never restores a PC from one.

Anything failing before step 5 leaves the database as it was; the System page shows "Failed:
nothing removed" with the reason. A server stopped mid-way marks the run failed when it starts.

### The purge login (installer, P0-16)

Only members of `rp_purge` may delete those records (AUD-004); the application's role never can.
The installer creates a login for it (`setup-cli database`, P0-16b; see `windows-services.md`) and
the service host gives the server its address:

```sql
CREATE ROLE rp_purger LOGIN PASSWORD '<random, kept by the installer>' IN ROLE rp_purge;
```

```
RP_PURGE_DATABASE_URL=postgresql://rp_purger:<password>@localhost:5432/<database>
```

Without it, the Owner sees "This PC has no purge login yet" and no year can be archived.

### Reading an archive (P7-06c)

The archive viewer opens an archived year read-only, straight from its file, without putting
anything back into the live database (DATA-009): System, then "Old years", then "Open" beside a
finished archive. The Owner and managers may open it.

- **Day by day**: invoices, voided invoices, sales and tax for each business date, and the year's
  totals. Read once per server start, then kept.
- **Find an invoice** by business date or invoice number; open it to see it as printed and print it
  again.

The archive file must be where it was written. If its drive is not connected the page says where it
should be ("The archive file is not at …"); connect the drive and try again.

An archive is encrypted with the backup key of the PC that made it. A PC restored from another
PC's backup (a new PC after a failure, `backups.md`) keeps its own backup key for what it writes
next, and keeps the old PC's key (and the keys that PC knew) for reading: the restore stores them
in the database, sealed with a key derived from the new PC's own backup key (P7-10). So the old
PC's archives open on the new PC as before. An archive whose key this PC never learned (made on
another restaurant's PC, or on a PC this one was not restored from) is refused with "a backup key
this PC does not know"; restore that PC's backup here first, or ask support. The invoice register
and the PDF books beside the archive are readable without the app, and `verifyBusinessArchive`
checks an archive end to end.

## The full data export (P7-06c)

The restaurant's data belongs to the restaurant (DATA-010). The Owner exports all of it in open
formats at any time, also while the licence restricts ordering (LIC-005 gates ordering only):
System, then "Old years", then "Export all data…". It needs the Owner; it is audited (`DATA_EXPORTED`).

It writes `rp-export-<time>` into the folder typed in (a whole path, like `E:\Exports`), or into
the second backup location's `rp-exports` folder:

```
json\<table>.jsonl          every row of each table, one JSON object per line
csv\<table>.csv             the same rows as CSV (lists and objects written as JSON)
invoice-register.csv        every invoice: number, date, status, customer, taxable value, taxes
                            by code, totals, in rupees
invoices\FY<year>\<month>\<date>.pdf   every invoice of the day as printed
README.txt                  what each file is
```

All tables are read in one read-only snapshot, so the files are one consistent moment however long
the export takes. Amounts in the tables are paise; times are UTC; dates are business dates.
Passwords, PINs, keys, sessions, one-time codes and every `*_hash` column are left out, as are the
server's own bookkeeping tables (migrations, outbox, idempotency records).

The System page shows the export running, then where it went or why it failed. A failed export
leaves what it wrote; delete the folder and start again. Years already archived are not in the
export: their archive and the human-readable files beside it are.
