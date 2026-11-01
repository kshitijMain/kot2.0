import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { type RunningServer, startServer } from './server.js';

/**
 * P9-28 acceptance: the waiter app in a phone's browser, served by the restaurant PC at /phone/,
 * does what the Android app does, for waiters, managers and the Owner. It runs as the `iphone`
 * project (WebKit, the engine of every iPhone browser, Chrome included) and the `android` project
 * (Chrome on an Android phone), each against its own restaurant (global-setup.ts).
 */

/** People from the development seed (apps/server/src/database/dev-seed.ts). */
const OWNER = { name: 'Asha (Owner)', pin: '1111' };
const MANAGER = { name: 'Vikram (Manager)', pin: '2222' };
const WAITER = { name: 'Ravi', pin: '4444' };
/** A dish without sizes or add-ons: one tap adds it. */
const DISH = 'Veg Spring Roll';

/** What the browser refused under the page's CSP and Trusted Types (SEC-017). */
const policyViolations: string[] = [];
function watchPolicy(context: BrowserContext): void {
  const refused = /Content Security Policy|Trusted ?Type|TrustedHTML|TrustedScript/i;
  context.on('console', (message) => {
    if (refused.test(message.text())) policyViolations.push(message.text());
  });
  context.on('weberror', (error) => {
    if (refused.test(error.error().message)) policyViolations.push(error.error().message);
  });
}

async function signIn(page: Page, person: { name: string; pin: string }): Promise<void> {
  await page.getByText(person.name, { exact: true }).click();
  for (const digit of person.pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(page.getByText('All tables', { exact: true })).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByTestId('home-menu').click();
  await page.getByTestId('sign-out').click();
  await expect(page.getByText('Tap your name')).toBeVisible();
}

/** A table's tile on the floor, by its label. */
function tableTile(page: Page, label: string) {
  return page.getByText(label, { exact: true }).first();
}

test.describe.serial('[P9-28] the waiter app in a phone’s browser', () => {
  let server: RunningServer;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    const project = testInfo.project.name === 'iphone' ? 'IPHONE' : 'ANDROID';
    const databaseUrl = process.env[`RP_E2E_PHONE_${project}_DATABASE_URL`];
    const dataDir = process.env[`RP_E2E_PHONE_${project}_DATA_DIR`];
    if (databaseUrl === undefined || dataDir === undefined) {
      throw new Error('Run the phone tests through Playwright (global setup prepares them)');
    }
    // PIN-only, as the restaurants run: the phone connects with nobody pairing it (ADR-0025).
    server = await startServer(undefined, {
      databaseUrl,
      dataDir,
      env: { RP_AUTH_PIN_ONLY: '1' },
    });
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
    context = await browser.newContext({
      ...(viewport !== undefined && { viewport }),
      ...(userAgent !== undefined && { userAgent }),
      ...(deviceScaleFactor !== undefined && { deviceScaleFactor }),
      ...(isMobile !== undefined && { isMobile }),
      ...(hasTouch !== undefined && { hasTouch }),
    });
    watchPolicy(context);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
    await server.stop();
  });

  test('[WTR-001] [AUTH-007] connects to the PC that served it, with nothing to scan or type', async () => {
    await page.goto(`${server.url}/phone`);
    // /phone is sent to /phone/, where the app's files are.
    await expect(page).toHaveURL(`${server.url}/phone/`);
    await expect(page.getByText('Tap your name')).toBeVisible();
    // Waiters, managers and the Owner sign in on a phone; the kitchen does not (P9-28).
    for (const name of [OWNER.name, MANAGER.name, WAITER.name]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Chef Imran', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('connect-scan')).toHaveCount(0);
    // Inter, the apps' face, from the PC (ADR-0022), not a fallback.
    const inter = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('600 16px Inter');
    });
    expect(inter).toBe(true);
  });

  test('[WTR-002] [WTR-003] [TBL-003] a waiter opens a table, sends a KOT and asks for the bill', async () => {
    // A keyboard types the PIN too (P9-28).
    await page.getByText(WAITER.name, { exact: true }).click();
    await page.keyboard.type(WAITER.pin);
    await expect(page.getByText('All tables', { exact: true })).toBeVisible();
    await tableTile(page, '1').click();
    await page.getByTestId('open-table').click();
    await expect(page.getByText('Table 1 is open')).toBeVisible();
    await page.getByText('Add from the menu').click();
    // The browser's back closes a dish's options, not the menu under it.
    await page.getByTestId('menu-search').fill('Paneer Butter');
    await page.getByText('Paneer Butter Masala', { exact: true }).first().click();
    await expect(page.getByTestId('item-add')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('item-add')).toHaveCount(0);
    await expect(page.getByTestId('menu-search')).toBeVisible();
    await page.getByTestId('menu-search').fill('Spring');
    await page.getByText(DISH, { exact: true }).first().click();
    await page.getByTestId('menu-search').fill('Gulab');
    await page.getByText('Gulab Jamun', { exact: true }).first().click();
    await expect(page.getByText(/2 new items/)).toBeVisible();
    await page
      .getByText(/^Order \(/)
      .first()
      .click();
    // Dessert later: held, then sent when the table is ready for it.
    await page.getByRole('button', { name: 'Hold Gulab Jamun for later' }).click();
    await page.getByTestId('send-kot').click();
    await expect(page.getByText(/Order \d+ sent to the kitchen/).first()).toBeVisible();
    await expect(page.getByText(/^KOT \d+/).first()).toBeVisible();
    await page
      .getByTestId(/^fire-/)
      .first()
      .click();
    await expect(page.getByText('Held items sent to the kitchen')).toBeVisible();
    // The kitchen has not started the roll: it is cancelled with a reason.
    await page.getByRole('button', { name: `More for ${DISH}` }).click();
    await expect(page.getByText('Cancel this dish', { exact: true })).toBeVisible();
    await page.getByText('Cancel this dish', { exact: true }).click();
    await page.getByText('Ordered by mistake', { exact: true }).click();
    await page.getByTestId('end-item-confirm').click();
    await expect(page.getByText(`${DISH} cancelled`)).toBeVisible();
    await page.getByText('Request bill', { exact: true }).click();
    await expect(page.getByText('Bill requested for 1.')).toBeVisible();
  });

  test('[P9-28] the browser’s back (an iPhone’s swipe) closes the table, not the app', async () => {
    await page.goBack();
    await expect(page.getByText('All tables', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${server.url}/phone/`);
    await expect(page.getByText('Bill requested', { exact: true })).toBeVisible();
  });

  test('[TBL-005] [WTR-013] a waiter moves a table and sends a takeaway', async () => {
    await tableTile(page, '5').click();
    await page.getByTestId('open-table').click();
    await page.getByText('Move table', { exact: true }).click();
    await page
      .getByTestId(/^move-to-/)
      .first()
      .click();
    await expect(page.getByText(/^5 moved to \S+/)).toBeVisible();
    await page.getByText('Back', { exact: true }).first().click();
    await page.getByTestId('home-menu').click();
    await page.getByTestId('new-takeaway').click();
    await page.getByTestId('menu-search').fill('Chai');
    await page.getByText('Masala Chai', { exact: true }).first().click();
    await page.getByLabel('Customer name (optional)').fill('Meera');
    await page.getByTestId('send-takeaway').click();
    await expect(page.getByText(/Token \d+: order \d+ sent to the kitchen/)).toBeVisible();
    await page.goBack();
    await expect(page.getByText('All tables', { exact: true })).toBeVisible();
  });

  test('[BILL-005] [BILL-008] a manager prints the bill and takes it in two payments on the phone', async () => {
    await signOut(page);
    await signIn(page, MANAGER);
    await tableTile(page, '1').click();
    await page.getByText('Print bill', { exact: true }).click();
    // No printer in the tests: the bill is issued all the same, and says so.
    await expect(page.getByText(/^Bill \S+ (printed|issued)/)).toBeVisible();
    await page.getByText('Take payment', { exact: true }).click();
    // Part by UPI: the sheet stays open with the rest filled in (P9-28).
    await page.getByLabel('Amount (₹)').fill('50');
    await page.getByTestId('record-payment').click();
    await expect(page.getByTestId('payment-recorded')).toContainText('still to pay');
    await expect(page.getByLabel('Amount (₹)')).not.toHaveValue('50');
    await page.getByText('Card', { exact: true }).click();
    await page.getByTestId('record-payment').click();
    await expect(page.getByText(/Invoice \S+ is paid/)).toBeVisible();
    await page.goBack();
    await expect(page.getByText('All tables', { exact: true })).toBeVisible();
  });

  test('[MGR-001] the Owner works from the phone, with the full dashboard a tap away', async () => {
    await signOut(page);
    await signIn(page, OWNER);
    await page.getByTestId('home-menu').click();
    await expect(page.getByText('Signed in as Asha (Owner)')).toBeVisible();
    // The Owner covers nobody's break.
    await expect(page.getByText('Go on break')).toHaveCount(0);
    await expect(page.getByTestId('web-alerts')).toBeVisible();
    const opened = context.waitForEvent('page');
    await page.getByTestId('open-dashboard').click();
    const dashboard = await opened;
    await dashboard.waitForLoadState();
    await expect(dashboard).toHaveURL(new RegExp(`^${server.url}/`));
    await dashboard.close();
  });

  test('[AUTH-005] stays connected and signed in across a reload', async () => {
    await page.reload();
    await expect(page.getByText('All tables', { exact: true })).toBeVisible();
    await signOut(page);
  });

  test('[P9-28] keeps the app to one tab: the newest takes over, and "Use it here" takes it back', async () => {
    const second = await context.newPage();
    await second.goto(`${server.url}/phone/`);
    await expect(second.getByText('Tap your name')).toBeVisible();
    await expect(page.getByTestId('open-elsewhere')).toBeVisible();
    await page.getByTestId('use-here').click();
    await expect(page.getByText('Tap your name')).toBeVisible();
    await expect(second.getByTestId('open-elsewhere')).toBeVisible();
    await second.close();
  });

  test('[SEC-017] ran within the page’s CSP and Trusted Types', () => {
    expect(policyViolations).toEqual([]);
  });
});
