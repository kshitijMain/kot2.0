# Local set-up, running, testing and finishing the package

From an empty computer to every application running, tested and fixed, and the list of what
only a person can do to make the whole package ready. Written for the Business Owner's Mac; the
Windows notes say where a PC is needed. `developer-onboarding.md` is the short version.

Read in this order: §1 to §3 once, §4 to §8 per application, §9 to §11 every day, §12 to finish.

## 1. What you need

| Machine or device                               | For what                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| A Mac (or Linux) with 16 GB RAM, 30 GB free     | Everything except the Windows installer and real Android devices                |
| A Windows 11 PC (clean, or a VM)                | The installer, the Windows services, the restore rehearsal (manual task 14, 25) |
| An Android phone and a tablet (or the emulator) | The waiter app and the table tablet                                             |
| A thermal printer on the network, a cash drawer | Kitchen tickets and bills (manual task 13)                                      |
| An ESP32-S3 watch (LilyGO T-Watch S3)           | The pager, once its firmware exists (P0-H1, P2-05)                              |

## 2. Install the tools (macOS)

Install [Homebrew](https://brew.sh) first, then:

```bash
# Required for everything
brew install git nvm postgresql@16
nvm install 24 && nvm use 24          # the repository's .nvmrc; 22.12+ also works
corepack enable                        # gives the pnpm 10 that package.json names
brew services start postgresql@16      # a PostgreSQL 16 for running the apps
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc

# For the QR relay on local Supabase and the security scans
brew install --cask docker             # then open Docker Desktop once
brew install supabase/tap/supabase deno gitleaks

# For the Android apps
brew install --cask android-studio zulu@17   # then in Android Studio: SDK 35, an emulator (Pixel, API 35)
echo 'export ANDROID_HOME="$HOME/Library/Android/sdk"' >> ~/.zshrc
echo 'export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"' >> ~/.zshrc
curl -fsSL "https://get.maestro.mobile.dev" | bash   # the Android UI flows

# For the Windows set-up scripts' tests on the Mac (optional)
brew install --cask powershell && pwsh -c "Install-Module Pester -Force -Scope CurrentUser"

# Claude Code, to build and fix with Claude
npm install -g @anthropic-ai/claude-code
```

On Windows use the same tools from their installers (Node 24, PostgreSQL 16 from EDB, Git,
Docker Desktop, Android Studio) and set `TEST_DATABASE_URL` (§3).

## 3. Get the code and check it builds

```bash
git clone https://github.com/kshitijMain/kot2.0.git && cd kot2.0
nvm use
pnpm install                     # about 1,600 packages
pnpm build                       # every package (about 2 min the first time)
pnpm --filter @rp/console exec playwright install chromium   # the browser the e2e tests drive
node apps/desktop/node_modules/electron/install.js            # Electron, for the POS window (§8)
pnpm check                       # what CI runs: format, build, docs, lint, typecheck, all tests
```

`pnpm install` warns "Ignored build scripts: electron-winstaller, esbuild, ...". That is on
purpose (pnpm 10 blocks install scripts); nothing needs approving.

The integration tests start their own throwaway PostgreSQL. On a Mac they find Homebrew's
`initdb` in `/opt/homebrew/opt/postgresql@16/bin` by themselves. If they cannot (or on Windows),
point them at your installed PostgreSQL instead:

```bash
export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres   # a superuser login
```

`pnpm check` takes 10 to 15 minutes. What a clean run looks like: every package passes; the server
skips about 50 tests that need Windows, a real install or `RP_PERF=1`.

## 4. The restaurant system: server, POS, kitchen display, dashboard

The local server (`apps/server`) serves the web console (`apps/console`) at the same address.

### Start it

```bash
createdb rp_dev
cd apps/server
cp .env.example .env
# In .env set:
#   DATABASE_URL=postgresql://<your Mac user>@127.0.0.1:5432/rp_dev
#   RP_CONSOLE_DIR=../console/dist
#   RP_BACKUPS=off
pnpm db:migrate:deploy
pnpm db:seed          # a restaurant with 10 tables, 30 dishes, GST 5 % and 18 %, 6 staff
pnpm dev              # http://127.0.0.1:8080; reads .env and restarts when dist/ changes
                      # (`pnpm start` does not read .env)
```

`curl http://127.0.0.1:8080/api/v1/health` answers `{"status":"ok",...}`. The log warns that the
licence is missing; in development that restricts nothing.

To start over: `dropdb rp_dev && createdb rp_dev`, migrate and seed again.
To try a fresh install as a restaurant would (ONB-001): migrate but do **not** seed; the console then
asks for the restaurant's name and the Owner's PIN.

### Use it

1. Open `http://127.0.0.1:8080` in Chrome on the same Mac and click **Pair this PC**. (On any other
   device, a manager makes a pairing code in Manage → Devices.)
2. Sign in on a staff tile with a development PIN:

   | Person  | PIN        | Lands on        |
   | ------- | ---------- | --------------- |
   | Owner   | 1111       | Manage          |
   | Manager | 2222       | Manage          |
   | Cashier | 3333       | POS             |
   | Waiters | 4444, 5555 | POS             |
   | Kitchen | 6666       | Kitchen display |

3. A second screen (for example a kitchen station beside the POS): open the address in another
   Chrome profile or an incognito window, and pair it with a code from Manage → Devices.

For the console with hot reload while changing its code: keep the server running and
`pnpm --filter @rp/console dev` (Vite on http://localhost:5173, forwarding `/api` to :8080).
The component workbench (Storybook) is `pnpm --filter @rp/ui-web workbench`.

### What to try (a full service)

Use the role manuals in `docs/manuals/` and the scripts in `docs/usability/usability-test-scripts.md`
as test scripts. At least:

- **Cashier (POS):** open a table with guests; order a dish with a size and add-ons, a combo and a
  plain dish; Send KOT; a takeaway with the customer's name; move a table; free a table opened by
  mistake; bill with a discount (above the cashier's limit a manager types their PIN); split a
  bill; pay by cash and UPI with change; reprint (marked DUPLICATE); void and re-issue an invoice;
  open and close the shift; the day-end with its Z-report.
- **Kitchen:** tickets arrive by station; step items, bump, recall; "Notify manager" for food
  waiting at the pass.
- **Manager (Manage):** the overview and live order feed; Staff (add, PIN, unlock, deactivate);
  Today's sections; the menu editor (dish with photo, options, combo, sold out, Publish); Floor;
  Stations and printers (Test print); Settings; notification rules; Suggestions; Reports with
  CSV, Excel and PDF export and the drill-down; the audit trail and "Check the chain"; Devices;
  System; the set-up checklist.
- **Owner:** Security (password, authenticator, recovery codes); Restaurant (GSTIN, tax groups,
  invoice series), which asks for the second factor.

Printing without a printer: add a network printer pointing at a port you listen on
(`nc -l 9100 > ticket.bin`) to see the ESC/POS bytes; real printers are manual task 13.

### Ports to keep free

8080 (HTTP), 8883 (the pager broker, MQTT). A server you started by hand keeps 8883, and the
Playwright tests' own server then fails with `EADDRINUSE 127.0.0.1:8883`: stop yours before §10.

## 5. The waiter app and the table tablet (Android)

Both are Expo development builds, not Expo Go.

```bash
pnpm build                                    # the apps use the packages' dist/
emulator -avd <your AVD> &                    # or plug in a phone with USB debugging
pnpm --filter @rp/waiter-app prebuild         # generates android/ (never committed)
pnpm --filter @rp/waiter-app android          # builds, installs and opens it
pnpm --filter @rp/waiter-app start            # Metro, if it is not running already
```

Same for `@rp/table-tablet`. Then:

1. Keep `HOST=0.0.0.0` in the server's `.env`. From the emulator the Mac is `10.0.2.2`
   (`http://10.0.2.2:8080`); a real phone uses the Mac's Wi-Fi address on the same network.
2. In the console: Manage → Devices → Pair a device → Waiter phone (or Table tablet with its table).
3. In the app type the address and the code (or scan the QR code on a real phone), sign in as
   Ravi (4444), open a table, send a dish, mark it Ready on the kitchen display, serve it.

Development builds allow plain `http://`. Preview and production builds pair only over TLS with
the restaurant's own CA: start the server with `RP_TLS=on` to try that (the pairing QR code then
carries the CA's fingerprint).

Automated flows with Maestro (they assume the server on port 3000, so pass
`-e SERVER=http://10.0.2.2:8080`; the seeded tables are named 1 to 10):

```bash
maestro test -e SERVER=http://10.0.2.2:8080 -e PAIRING_CODE=ABCD-EFGH -e TABLE=1 -e TABLE2=2 \
  -e "DISH=Dal Makhani" apps/waiter-app/.maestro
maestro test -e SERVER=http://10.0.2.2:8080 -e PAIRING_CODE=... apps/table-tablet/.maestro
```

Unit and screen tests: `pnpm --filter @rp/waiter-app test`, `pnpm --filter @rp/table-tablet test`.
CI (`.github/workflows/android.yml`) builds a debug APK on every change; download it from the run's
artifacts to install on a phone without Android Studio. Kiosk mode needs a device-owner tablet
(manual task 12).

## 6. The QR menu and the cloud relay

The QR site (`apps/qr-menu`) talks to the relay (`infra/supabase`), and the restaurant's server
picks orders up from the relay. Two ways to try it:

- **Automated, no accounts:** `pnpm --filter @rp/qr-menu e2e` starts a real relay on a throwaway
  PostgreSQL and drives the site as a Pixel 7. Add `-- --ui` to watch it step by step. The server's
  `qr-exit.int.test.ts` runs the whole chain: table code, diner's order, approval, kitchen.
- **By hand on local Supabase (Docker):** `supabase start --workdir infra`, then
  `pnpm --filter @rp/relay build` (the functions `config.toml` names), and run the site with
  `RELAY_URL=<functions URL> pnpm --filter @rp/qr-menu dev` (http://localhost:3100/t/<token>). The
  tokens come from Manage → QR codes once the server has `RP_RELAY_URL` and its credential
  (`pnpm --filter @rp/server relay:credential`). The steps for a real Supabase project are manual
  task 20; they are the same against the local stack.

Relay tests: `pnpm --filter @rp/relay test` (PostgreSQL; the Deno smoke tests run when `deno` is
installed).

## 7. The vendor Control Plane and its web app

```bash
createdb cp_dev
cd apps/control-plane && cp .env.example .env
# In .env set DATABASE_URL=postgresql://<you>@127.0.0.1:5432/cp_dev and CP_WEB_DIR=../control-plane-web/dist
pnpm db:migrate:deploy
pnpm dev                                            # http://127.0.0.1:8090 (reads .env)
pnpm cli vendor-user:create --email you@example.com --name "You" --role SUPER_ADMIN
```

Open the `/setup#<token>` link it prints, set a password and an authenticator, and sign in.

Connect your local restaurant server to it (enrolment, heartbeats, releases, licences):

```bash
pnpm --filter @rp/control-plane cli tenant:create --name "Spice Route"
pnpm --filter @rp/control-plane cli installation:create --tenant <id> --name "Main PC"
pnpm --filter @rp/control-plane cli installation:code --installation <id>
# In apps/server/.env: RP_CONTROL_PLANE_URL=http://127.0.0.1:8090, then:
pnpm --filter @rp/server control-plane:enrol <code>
```

The PC then shows in the vendor app's fleet. Licences need a signing key in `CP_LICENCE_SIGNING_KEY`
(a throwaway Ed25519 key is fine locally; the real one is manual task 23). The vendor app's
Vite dev server is `pnpm --filter @rp/control-plane-web dev` (:5173, forwarding to :8090); its
end-to-end test is `pnpm --filter @rp/control-plane-web e2e`.

## 8. The POS window (Electron) and the Windows installer

- On the Mac: with the server running, `pnpm --filter @rp/desktop start` opens the console in the
  hardened Electron window. Its logic is tested without Electron by `pnpm --filter @rp/desktop test`.
- The installer is built and tested only on Windows: CI's "Windows installer" job builds it,
  installs, repairs, updates, rolls back and uninstalls on `windows-latest`. Download
  `windows-installer` from a run's artifacts and follow manual task 14 on a clean Windows 11 PC.
- The set-up scripts' tests: `pnpm installer:test` (needs `pwsh` and Pester).

## 9. Testing: every command

| Command                                                                                               | What                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                                          | Everything CI's main job runs. Must pass before every commit.                               |
| `pnpm test`                                                                                           | Every package's unit and integration tests                                                  |
| `pnpm --filter @rp/<pkg> test`                                                                        | One package (`domain`, `server`, `console`, `relay`, `control-plane`...)                    |
| `pnpm --filter @rp/server test:unit` / `test:int`                                                     | The server's unit or integration tests only                                                 |
| `pnpm --filter @rp/server exec vitest run --project integration test/integration/billing.int.test.ts` | One file                                                                                    |
| `pnpm --filter @rp/server scenario:service-day`                                                       | A simulated service day: about 100 orders, voids, discounts, splits, day-end                |
| `pnpm --filter @rp/server test:perf`                                                                  | The rush at design capacity (slow)                                                          |
| `pnpm --filter @rp/console e2e`                                                                       | The console in Chromium: pairing, every role, orders, KDS, bills, day-end, first run, speed |
| `pnpm --filter @rp/qr-menu e2e`                                                                       | The QR site as a phone against a real relay                                                 |
| `pnpm --filter @rp/control-plane-web e2e`                                                             | The vendor web app against the real Control Plane                                           |
| `... e2e -- --ui` or `-- --headed`                                                                    | Watch a Playwright run; `npx playwright show-trace <trace.zip>` after a failure             |
| `pnpm test:coverage`                                                                                  | With the coverage thresholds CI enforces                                                    |
| `pnpm security:dast`                                                                                  | OWASP ZAP against the four surfaces (`ZAP_DOCKER_IMAGE` or `ZAP_PATH`)                      |
| `pnpm secrets:scan`, `pnpm licenses:check`                                                            | Secrets in the history, dependency licences                                                 |
| `pnpm installer:test`                                                                                 | The Windows set-up scripts (Pester)                                                         |
| `pnpm trace`                                                                                          | `docs/build/TRACEABILITY.md`: every requirement and the tests that cover it                 |

All e2e suites need `pnpm build` first. Run them with nothing else on ports 8080 and 8883.

Two server test files fail on machines without IPv6 or without a network interface besides
loopback (`flood.int.test.ts`: `EAFNOSUPPORT ::`; `tls.int.test.ts`: no LAN address). That is the
machine, not the code; they pass on a normal Mac and in CI.

## 10. Finding bugs

Work from the outside in:

1. **Automated first.** `pnpm check`, then the three e2e suites. A red test names its requirement
   (`[BILL-003]`); look it up with `grep -n "BILL-003" docs/brd/requirements.md`.
2. **Exploratory testing.** Run a whole service (§4) as each role, on a phone-sized window too.
   Try what a busy restaurant does: two people on the same table, the network cable pulled
   (the offline banner must appear and recover), the server restarted mid-order, a double tap on
   Send (never two orders), a price changed while a cart is open.
3. **Against the rules.** `CLAUDE.md`, "Rules that are never broken": money in paise, the server
   recomputing every price, no deletions of bills or audit entries, permissions on every call.
   Any screen or API that breaks one is a bug even if every test passes.
4. **Against the requirements.** `docs/build/TRACEABILITY.md` lists each requirement and its
   tests; pick one with few tests and try it by hand.
5. **Evidence.** The server logs JSON with a `correlationId` per request (`LOG_PRETTY=true` in
   `.env` for readable lines); the error a screen shows carries the same ID. Manage → Audit trail
   shows who did what; "Check the chain" proves nothing was altered.
6. **Security and load.** `pnpm security:dast`, `pnpm --filter @rp/server test:perf`.

Write each bug down with the steps, what you expected, what happened, the role and device, and
the correlation ID: a GitHub issue, or straight to Claude (§11).

## 11. Fixing bugs

The repository's rules (`docs/build/CONVENTIONS.md`) in short:

```bash
git switch main && git pull
git switch -c fix/<short-name>              # or wp/<WP-id>-<slug> for planned work
# 1. a test that fails because of the bug, with the requirement ID in its title
# 2. the fix: business rules in packages/domain, shapes in packages/contracts, text in packages/i18n
pnpm check                                  # must pass
pnpm trace                                  # refresh the traceability report
# 3. a session-log line in docs/build/PROGRESS.md
git commit -m "P1-10a: <what the fix does>"  # starts with the WP or requirement ID
git push -u origin fix/<short-name>         # then open a pull request
```

CI then runs `ci.yml` (checks, e2e, Windows, relay on Supabase), `security.yml` (CodeQL, audit,
DAST) and `android.yml` (APKs). Merge when they are green.

With Claude Code (in the repository folder, `claude`): describe the bug with its steps, or paste
the failing output; Claude reads `CLAUDE.md`, writes the failing test, fixes, runs `pnpm check`
and pushes. `/next-step` builds the next work package from `PROGRESS.md`; `/code-review` reviews a
branch before you merge it.

## 12. Finishing the package: what is left, in order

What Claude can build is built. What is left needs a person, an account or a device;
`MANUAL_TASKS.md` is the list to tick and `manual-tasks/NN-*.md` has each procedure. In the order
that unblocks the most:

### Step 1: the repository (an hour)

- Protect `main` (pull requests and the CI checks required) and require 2FA: manual task 01.

### Step 2: accounts and keys (the Business Owner; weeks, mostly waiting)

Each one turns finished code on. Never paste a key or password into a Claude session or a commit;
they go into the secret manager or the GitHub environment the procedure names.

| Account or key                                                 | Unblocks                             | Task            |
| -------------------------------------------------------------- | ------------------------------------ | --------------- |
| Domain name and DNS                                            | QR site, Control Plane, updates      | owner checklist |
| Cloud hosting in India with a KMS / secret manager             | The Control Plane, licence signing   | owner checklist |
| Windows code-signing certificate                               | Signed installer and updates         | 31              |
| Supabase organisation (Mumbai), the relay deployed             | QR ordering                          | 20              |
| Hosting for the QR site                                        | QR ordering                          | 21              |
| Licence-signing key in the KMS, two-person code review         | Licences                             | 23              |
| Sentry-compatible error service (two projects)                 | Error reports                        | 24              |
| S3 bucket in ap-south-1 with object lock                       | Cloud backups                        | 26              |
| Backup key escrow policy and KMS key                           | Restore from the cloud               | 27              |
| Expo account, Android keystore, update signing keys            | Signed APKs and over-the-air updates | 29              |
| Pager firmware secure boot key (offline)                       | Pager firmware updates               | 30              |
| Edge rate limits in front of the Control Plane, relay, QR site | Flood protection at the edge         | 32              |
| The Control Plane host's log store and operator host           | Audit copies, the admin CLI          | 34              |
| AI provider key                                                | AI menu import                       | 22              |
| WhatsApp Business number and template (SMS needs DLT)          | Digital bills                        | 28              |
| MDM subscription, transactional e-mail                         | Kiosk tablets, e-mails               | owner checklist |

### Step 3: devices and on-site tests (ready now)

| Test                                                                         | Task |
| ---------------------------------------------------------------------------- | ---- |
| The installer on a clean Windows 11 PC, the webcam reading a pager's QR code | 14   |
| The PC's accounts, BitLocker, staff Wi-Fi                                    | 35   |
| Thermal printers and the cash drawer                                         | 13   |
| Kiosk mode on the chosen tablet                                              | 12   |
| Android checks on a real phone and tablet                                    | 33   |
| Wi-Fi coverage walk at the pilot site                                        | 11   |
| Restore rehearsal with RTO and RPO timed (after 14)                          | 25   |

Paste each results template into a Claude session; Claude fixes what they find.

### Step 4: the pager (Claude writes the firmware, you run it)

Ask Claude for P0-H1 (battery prototype firmware), run manual task 10, then P2-05 (production
firmware) and manual task 15. After that the lab-rig tests (16, P2-07), voice search (17, P6-03),
failure drills (18, P8-02) and S1 on the lab rig (P8-01c).

### Step 5: decisions only the Business Owner makes

Each has a default already built (`PROGRESS.md`, "Decisions"); confirm or change: refund on a
voided paid invoice, product name and brand (OI-01), bar and liquor VAT (OI-03), hardware and MDM
vendor (OI-04, OI-05), WhatsApp or SMS (OI-06), grace period and terms (OI-08), key escrow and a
second approver (OI-10), pricing.

### Step 6: legal, compliance and the pilot

Subscription agreement / EULA, DPA and privacy notices (the QR site's `/privacy` and `/terms` are
drafts); DPDP review and a CERT-In contact; the incident response plan's names, the tabletop
exercise and the penetration test (36); WPC and BIS certification of the pager; the pilot
restaurant, its baselines and its CA's confirmation of the invoice and tax rates; approval of the
menu template, manuals and training-video scripts. Then the pilot itself: UAT, 4 weeks live
(P8-06c), with usability results and a TalkBack pass (P8-04c).

The package is ready when every box in `MANUAL_TASKS.md` is ticked, `PROGRESS.md` shows every WP
done, and CI, CodeQL and the e2e suites are green on `main`.
