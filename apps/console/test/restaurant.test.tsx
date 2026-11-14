import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@rp/domain';
import type { FakeServer } from './fake-server.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';
import { EXEMPT, profileView, seriesViews, TAKEAWAY, taxGroupViews } from './restaurant-fixture.js';

const PATH = '/manage/restaurant';

function restaurantServer(role: Role = 'OWNER'): FakeServer {
  return (
    signsInAs(server(), role)
      .on('GET', '/api/v1/restaurant', () => ({ status: 200, body: profileView() }))
      .on('GET', '/api/v1/tax-groups', () => ({
        status: 200,
        body: { taxGroups: taxGroupViews() },
      }))
      .on('GET', '/api/v1/invoice-series', () => ({
        status: 200,
        body: { invoiceSeries: seriesViews() },
      }))
      .on('PUT', '/api/v1/restaurant/profile', () => ({ status: 200, body: profileView() }))
      // ADR-0031: the bill settings and the printed bill's preview.
      .on('GET', '/api/v1/settings', () => ({ status: 200, body: { settings: BILL_SETTINGS } }))
      .on('POST', '/api/v1/restaurant/invoice-preview', (call) => ({
        status: 200,
        body: { lines: previewOf(call.body as Record<string, unknown>) },
      }))
  );
}

/** What the server's preview prints, enough to see each choice reach it. */
function previewOf(body: Record<string, unknown>): string[] {
  const footer = (body.footerLines as string[] | undefined) ?? [];
  return [
    String(body.legalName),
    `Bill no ${String(body.invoiceNumber)}`,
    ...footer,
    String(body.thankYouLine).replace('{restaurant}', String(body.displayName)),
  ];
}

const setting = (key: string, value: unknown) => ({
  key,
  value,
  defaultValue: value,
  isDefault: true,
  scope: 'RESTAURANT',
  capability: 'TAX_AND_INVOICE_SETTINGS',
  editable: true,
  description: '',
  requirements: [],
  updatedAt: null,
});

const BILL_SETTINGS = [
  setting('bills.headerLines', []),
  setting('bills.footerLines', []),
  setting('bills.thankYouLine', 'Thank you for dining at {restaurant}!'),
  setting('bills.printPhone', true),
  setting('bills.printFssai', true),
  setting('bills.amountInWords', true),
];

const dialog = (name: string) => screen.findByRole('dialog', { name });
const section = async (name: string) =>
  (await screen.findByRole('heading', { level: 3, name })).closest('section')!;

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[ONB-004] [BILL-002] [BILL-003] [BILL-004] the restaurant page', () => {
  it('shows the profile, invoice particulars, tax groups and series', async () => {
    const { container, user } = await renderConsole({
      fake: restaurantServer(),
      path: '/manage',
      signedIn: 'OWNER',
    });
    await user.click(
      within(screen.getByRole('navigation', { name: t('dashboard.navigation') })).getByRole(
        'link',
        { name: t('dashboard.section.restaurant') },
      ),
    );
    const profile = within(await section(t('restaurantPage.profile.title')));
    expect(profile.getByText('Spice Route')).toBeVisible();
    expect(
      profile.getByText(`${t('restaurantPage.weekday.MON')}: 11:00 to 15:00, 19:00 to 23:30`),
    ).toBeVisible();
    expect(
      profile.getByText(
        `${t('restaurantPage.weekday.TUE')}: ${t('restaurantPage.profile.closed')}`,
      ),
    ).toBeVisible();
    const legal = within(await section(t('restaurantPage.legal.title')));
    expect(legal.getByText('27AAPFU0939F1ZV')).toBeVisible();
    expect(legal.getByText('12 MG Road, Pune 411001')).toBeVisible();
    const tax = within(await section(t('restaurantPage.taxGroups.title')));
    expect(tax.getByText('CGST 2.5% + SGST 2.5%')).toBeVisible();
    expect(tax.getByText(t('restaurantPage.taxGroups.noTax'))).toBeVisible();
    const series = within(await section(t('restaurantPage.series.title')));
    expect(series.getByText(t('restaurantPage.series.default'))).toBeVisible();
    expect(series.getByText(t('restaurantPage.series.fixed'))).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('lets a manager change the profile but not what the Owner changes', async () => {
    const fake = restaurantServer('MANAGER');
    const { user } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    const legal = within(await section(t('restaurantPage.legal.title')));
    expect(legal.queryByRole('button', { name: t('restaurantPage.change') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('restaurantPage.taxGroups.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('restaurantPage.series.add') })).toBeNull();

    const profile = within(await section(t('restaurantPage.profile.title')));
    await user.click(profile.getByRole('button', { name: t('restaurantPage.change') }));
    const form = within(await dialog(t('restaurantPage.profile.dialogTitle')));
    await user.click(
      form.getByRole('button', {
        name: t('restaurantPage.profile.addHours', { day: t('restaurantPage.weekday.TUE') }),
      }),
    );
    await user.click(form.getByRole('button', { name: t('restaurantPage.save') }));
    expect(form.getAllByText(t('restaurantPage.problems.HOURS_INVALID')).length).toBeGreaterThan(0);
    expect(fake.callsTo('PUT', '/api/v1/restaurant/profile')).toHaveLength(0);

    await user.click(
      form.getByRole('button', {
        name: t('restaurantPage.profile.removeHours', {
          day: t('restaurantPage.weekday.TUE'),
          number: 1,
        }),
      }),
    );
    const email = form.getByRole('textbox', { name: t('restaurantPage.profile.email') });
    await user.type(email, 'owner@spiceroute.in');
    // The tablets' accent colour (P3-01a): checked like the other fields.
    const accent = form.getByRole('textbox', { name: t('restaurantPage.profile.accent') });
    await user.type(accent, 'red');
    await user.click(form.getByRole('button', { name: t('restaurantPage.save') }));
    expect(form.getByText(t('restaurantPage.problems.ACCENT_INVALID'))).toBeVisible();
    await user.clear(accent);
    await user.type(accent, '#b4232a');
    await user.click(form.getByRole('button', { name: t('restaurantPage.save') }));
    expect(await screen.findByText(t('restaurantPage.profile.saved'))).toBeVisible();
    expect(fake.callsTo('PUT', '/api/v1/restaurant/profile')[0]?.body).toMatchObject({
      contact: { phone: '+91 98765 43210', email: 'owner@spiceroute.in' },
      accentColor: '#B4232A',
      businessDayCutoff: '04:00',
    });
  });

  it('[AUTH-012] adds a tax group as the Owner, with no password or authenticator asked', async () => {
    const fake = restaurantServer().on('POST', '/api/v1/tax-groups', () => ({
      status: 201,
      body: taxGroupViews()[0],
    }));
    const { user } = await renderConsole({ fake, path: PATH, signedIn: 'OWNER' });
    await user.click(
      await screen.findByRole('button', { name: t('restaurantPage.taxGroups.add') }),
    );
    const form = within(await dialog(t('restaurantPage.taxGroups.addTitle')));
    await user.type(
      form.getByRole('textbox', { name: t('restaurantPage.taxGroups.name') }),
      'GST 18%',
    );
    const rates = form.getAllByRole('textbox', { name: t('restaurantPage.taxGroups.rate') });
    await user.type(rates[0]!, '9');
    await user.type(rates[1]!, '9');
    expect(form.getByText(t('restaurantPage.taxGroups.draftTotal', { rate: '18' }))).toBeVisible();
    await user.click(form.getByRole('button', { name: t('restaurantPage.save') }));
    expect(
      await screen.findByText(t('restaurantPage.taxGroups.added', { name: 'GST 18%' })),
    ).toBeVisible();
    expect(fake.callsTo('POST', '/api/v1/tax-groups').map((call) => call.body)).toEqual([
      {
        name: 'GST 18%',
        sacCode: '996331',
        components: [
          { code: 'CGST', rateBp: 900 },
          { code: 'SGST', rateBp: 900 },
        ],
      },
    ]);
  });

  it('archives a tax group with a reason, and makes a series the default', async () => {
    const fake = restaurantServer()
      .on('POST', `/api/v1/tax-groups/${EXEMPT}/archive`, () => ({
        status: 200,
        body: { ...taxGroupViews()[1], archivedAt: '2026-10-01T10:00:00.000Z' },
      }))
      .on('POST', `/api/v1/invoice-series/${TAKEAWAY}/default`, () => ({
        status: 200,
        body: { ...seriesViews()[1], isDefault: true },
      }));
    const { user } = await renderConsole({ fake, path: PATH, signedIn: 'OWNER' });
    await user.click(
      within(
        await screen.findByRole('group', {
          name: t('restaurantPage.taxGroups.actionsFor', { name: 'Exempt' }),
        }),
      ).getByRole('button', { name: t('restaurantPage.taxGroups.archive') }),
    );
    const archive = within(
      await dialog(t('restaurantPage.taxGroups.archiveTitle', { name: 'Exempt' })),
    );
    await user.type(archive.getByRole('textbox'), 'Not used');
    await user.click(archive.getByRole('button', { name: t('restaurantPage.taxGroups.archive') }));
    expect(
      await screen.findByText(t('restaurantPage.taxGroups.archived', { name: 'Exempt' })),
    ).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/tax-groups/${EXEMPT}/archive`)[0]?.body).toEqual({
      reason: 'Not used',
    });
    // The group still used by dishes keeps its actions; the default series has no Make default.
    expect(
      screen.getByRole('group', {
        name: t('restaurantPage.taxGroups.actionsFor', { name: 'GST 5%' }),
      }),
    ).toBeVisible();

    await user.click(
      within(
        screen.getByRole('group', {
          name: t('restaurantPage.series.actionsFor', { name: 'Takeaway' }),
        }),
      ).getByRole('button', { name: t('restaurantPage.series.makeDefault') }),
    );
    const confirm = within(
      await dialog(t('restaurantPage.series.defaultTitle', { name: 'Takeaway' })),
    );
    await user.click(confirm.getByRole('button', { name: t('restaurantPage.series.makeDefault') }));
    await waitFor(() => {
      expect(fake.callsTo('POST', `/api/v1/invoice-series/${TAKEAWAY}/default`)).toHaveLength(1);
    });
    expect(
      within(
        screen.getByRole('group', {
          name: t('restaurantPage.series.actionsFor', { name: 'Dine-in' }),
        }),
      ).queryByRole('button', { name: t('restaurantPage.series.makeDefault') }),
    ).toBeNull();
  });

  it('keeps a series format fixed once it has invoices', async () => {
    const { user } = await renderConsole({
      fake: restaurantServer(),
      path: PATH,
      signedIn: 'OWNER',
    });
    await user.click(
      within(
        await screen.findByRole('group', {
          name: t('restaurantPage.series.actionsFor', { name: 'Dine-in' }),
        }),
      ).getByRole('button', { name: t('restaurantPage.series.edit') }),
    );
    const form = within(await dialog(t('restaurantPage.series.editTitle', { name: 'Dine-in' })));
    expect(form.getByText(t('restaurantPage.series.fixedHint'))).toBeVisible();
    expect(form.getByRole('textbox', { name: t('restaurantPage.series.prefix') })).toBeDisabled();
  });
});

describe('[BILL-002] [ONB-004] invoice settings (ADR-0031)', () => {
  it('shows the bill as it prints, with the thank-you line, to everyone', async () => {
    await renderConsole({
      fake: restaurantServer('MANAGER'),
      path: '/manage/restaurant',
      signedIn: 'MANAGER',
    });
    const invoice = await section(t('invoiceSettings.title'));
    const paper = await within(invoice).findByRole('figure', {
      name: t('invoiceSettings.preview'),
    });
    expect(await within(paper).findByText(/Thank you for dining at Spice Route!/)).toBeVisible();
    // Managers see it; only the Owner changes it.
    expect(within(invoice).queryByRole('button', { name: t('invoiceSettings.edit') })).toBeNull();
  });

  it('lets the Owner change the footer with the bill updating as they type, then saves it', async () => {
    const fake = restaurantServer('OWNER').on(
      'PUT',
      '/api/v1/settings/bills.footerLines',
      (call) => ({
        status: 200,
        body: setting('bills.footerLines', (call.body as { value: unknown }).value),
      }),
    );
    const { user, container } = await renderConsole({
      fake,
      path: '/manage/restaurant',
      signedIn: 'OWNER',
    });
    const invoice = await section(t('invoiceSettings.title'));
    await user.click(within(invoice).getByRole('button', { name: t('invoiceSettings.edit') }));
    const form = within(await dialog(t('invoiceSettings.dialogTitle')));
    await user.type(
      form.getByLabelText(t('invoiceSettings.footerLine', { number: 1 })),
      'Open 11 to 11',
    );
    const paper = form.getByRole('figure', { name: t('invoiceSettings.preview') });
    expect(await within(paper).findByText(/Open 11 to 11/)).toBeVisible();
    await expectNoAxeViolations(container);
    await user.click(form.getByRole('button', { name: t('restaurantPage.save') }));
    await waitFor(() => {
      expect(fake.callsTo('PUT', '/api/v1/settings/bills.footerLines')[0]?.body).toEqual({
        value: ['Open 11 to 11'],
      });
    });
    // Nothing else changed, so nothing else was sent.
    expect(fake.callsTo('PUT', '/api/v1/restaurant/legal')).toHaveLength(0);
    expect(fake.callsTo('PUT', '/api/v1/settings/bills.thankYouLine')).toHaveLength(0);
  });

  it('asks the Owner to confirm before another series numbers the bills mid-year', async () => {
    const fake = restaurantServer('OWNER').on(
      'POST',
      `/api/v1/invoice-series/${TAKEAWAY}/default`,
      () => ({ status: 200, body: { ...seriesViews()[1], isDefault: true } }),
    );
    const { user } = await renderConsole({ fake, path: '/manage/restaurant', signedIn: 'OWNER' });
    const invoice = await section(t('invoiceSettings.title'));
    await user.click(within(invoice).getByRole('button', { name: t('invoiceSettings.edit') }));
    const form = within(await dialog(t('invoiceSettings.dialogTitle')));
    await user.selectOptions(form.getByLabelText(t('invoiceSettings.series.label')), TAKEAWAY);
    expect(form.getByText(t('invoiceSettings.series.warning'))).toBeVisible();
    const paper = form.getByRole('figure', { name: t('invoiceSettings.preview') });
    expect(await within(paper).findByText(/TA\/26-27\/000001/)).toBeVisible();
    await user.click(form.getByRole('button', { name: t('restaurantPage.save') }));
    expect(await form.findByText(t('invoiceSettings.series.confirmFirst'))).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/invoice-series/${TAKEAWAY}/default`)).toHaveLength(0);
    await user.click(form.getByRole('checkbox', { name: t('invoiceSettings.series.confirm') }));
    await user.click(form.getByRole('button', { name: t('restaurantPage.save') }));
    await waitFor(() => {
      expect(fake.callsTo('POST', `/api/v1/invoice-series/${TAKEAWAY}/default`)).toHaveLength(1);
    });
  });
});
