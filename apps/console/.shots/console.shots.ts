import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { createTranslator } from '@rp/i18n';
import { startServer } from '../e2e/server.js';

const t = createTranslator();
const OUT = process.env.SHOTS_DIR ?? '/tmp/shots';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize(DESKTOP);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}-desktop.png`), fullPage: false });
  await page.setViewportSize(PHONE);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}-phone.png`), fullPage: false });
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(200);
}

async function signIn(page: Page, name: RegExp, pin: string): Promise<void> {
  await page.getByRole('button', { name }).click();
  await page.keyboard.type(pin);
}

test('screens', async ({ browser }) => {
  const server = await startServer();
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  try {
    const bootstrap = await fetch(`${server.url}/api/v1/devices/pairing-codes/bootstrap`, {
      method: 'POST',
    });
    const { code } = (await bootstrap.json()) as { code: string };
    await page.goto(server.url);
    await expect(page).toHaveURL(/\/pair$/);
    await shoot(page, '01-pairing');
    await page.getByLabel(t('pairing.codeLabel')).fill(code);
    await page.getByRole('button', { name: t('pairing.submit') }).click();
    await expect(page.getByRole('heading', { name: t('login.title') })).toBeVisible();
    await shoot(page, '02-sign-in');

    await page.getByRole('button', { name: /^Neha \(Cashier\)/ }).click();
    await expect(
      page.getByRole('heading', { name: t('login.pinFor', { name: 'Neha (Cashier)' }) }),
    ).toBeVisible();
    await page.keyboard.type('33');
    await shoot(page, '03-pin');
    await page.keyboard.type('33');

    const hall = page.getByRole('region', { name: 'Main Hall' });
    await expect(hall.getByRole('button', { name: '1, Free' })).toBeVisible();
    await hall.getByRole('button', { name: '1, Free' }).click();
    const open = page.getByRole('dialog', { name: t('pos.open.title', { table: '1' }) });
    await open.getByLabel(t('pos.open.guests'), { exact: true }).fill('2');
    await shoot(page, '05-open-table-dialog');
    await open.getByRole('button', { name: t('pos.open.submit') }).click();
    await page.keyboard.press('Escape');
    await expect(hall.getByRole('button', { name: /^1, Occupied/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await shoot(page, '04-pos-floor');

    await hall.getByRole('button', { name: /^1, Occupied/ }).click();
    await page.getByRole('button', { name: t('pos.table.takeOrder') }).click();
    await page.getByRole('button', { name: /^Chicken Tikka, / }).click();
    const tikka = page.getByRole('dialog', { name: 'Chicken Tikka' });
    await tikka.getByRole('radio', { name: /Full/ }).check();
    await tikka.getByRole('radio', { name: 'Medium' }).check();
    await shoot(page, '06-item-dialog');
    await tikka.getByRole('button', { name: t('pos.item.add') }).click();
    await page.getByRole('button', { name: 'Combos', exact: true }).click();
    await page.getByRole('button', { name: /^Veg Thali Combo, / }).click();
    const thali = page.getByRole('dialog', { name: 'Veg Thali Combo' });
    await thali.getByRole('radio', { name: 'Rasmalai' }).check();
    await thali.getByRole('button', { name: t('pos.item.add') }).click();
    await shoot(page, '07-order-entry');
    const cart = page.getByRole('complementary', { name: t('pos.cart.title') });
    await cart.getByRole('button', { name: t('pos.cart.send') }).click();
    await expect(page.getByText(/^Order \d+ sent to the kitchen$/)).toBeVisible();
    await page.getByRole('button', { name: t('pos.backToTables') }).click();

    await page.getByRole('button', { name: t('login.signOut') }).click();
    await signIn(page, /^Chef Imran/, '6666');
    await expect(page).toHaveURL(/\/kds$/);
    const ticket = page.getByRole('article', { name: /^KOT \d+, Table 1$/ });
    await expect(ticket).toBeVisible();
    await ticket.getByRole('button', { name: t('kds.allPreparing') }).click();
    await expect(ticket.getByRole('button', { name: t('kds.allReady') })).toBeVisible();
    await shoot(page, '08-kds');

    await page.getByRole('button', { name: t('login.signOut') }).click();
    await signIn(page, /^Vikram \(Manager\)/, '2222');
    await expect(page.getByRole('heading', { level: 1, name: t('modes.manage') })).toBeVisible();
    await page.waitForTimeout(1500);
    await shoot(page, '09-dashboard');

    // The kitchen theme setting, switched to dark the way a manager does it.
    await page
      .getByRole('navigation', { name: t('dashboard.navigation') })
      .getByRole('link', { name: t('dashboard.section.settings') })
      .click();
    const name = t('settingLabels.kds.theme');
    const row = page.locator('li', { has: page.getByRole('heading', { level: 4, name }) });
    await expect(row.getByText(t('settingsPage.choice.LIGHT'), { exact: true })).toBeVisible();
    await row.getByRole('button', { name: t('settingsPage.edit') }).click();
    const dialog = page.getByRole('dialog', { name: t('settingsPage.dialog.title', { name }) });
    await dialog.getByRole('combobox', { name }).selectOption('DARK');
    await dialog.getByRole('textbox', { name: t('settingsPage.dialog.reason') }).fill('Dim pass');
    await shoot(page, '10-kds-theme-setting');
    await dialog.getByRole('button', { name: t('settingsPage.dialog.save') }).click();
    await expect(row.getByText(t('settingsPage.choice.DARK'), { exact: true })).toBeVisible();

    await page.getByRole('button', { name: t('login.signOut') }).click();
    await signIn(page, /^Chef Imran/, '6666');
    await expect(page).toHaveURL(/\/kds$/);
    await expect(page.locator('[data-theme="kds-dark"]')).toBeVisible();
    await shoot(page, '11-kds-dark');
  } finally {
    await context.close();
    await server.stop();
  }
});
