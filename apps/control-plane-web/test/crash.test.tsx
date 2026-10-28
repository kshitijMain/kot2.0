import { createTranslator } from '@rp/i18n';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as SignInModule from '../src/screens/SignInScreen.js';
import { controlPlane, expectNoAxeViolations, renderApp } from './harness.js';

const t = createTranslator();
/** Whether the mocked sign-in screen throws while it renders (a bug in a screen). */
const crash = vi.hoisted(() => ({ on: true }));

vi.mock('../src/screens/SignInScreen.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SignInModule>();
  return {
    SignInScreen: () => {
      if (crash.on) throw new Error('A screen bug');
      return <actual.SignInScreen />;
    },
  };
});

describe('[NFR-U04] a screen that crashes (QA audit, category A)', () => {
  it('shows a plain message with a way back instead of a white page', async () => {
    crash.on = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, container } = renderApp({ cp: controlPlane() });
    expect(await screen.findByText(t('states.crashTitle'))).toBeInTheDocument();
    await expectNoAxeViolations(container);
    crash.on = false;
    await user.click(screen.getByRole('button', { name: t('states.retry') }));
    expect(
      await screen.findByRole('heading', { name: 'Parossa Control Plane' }),
    ).toBeInTheDocument();
    errors.mockRestore();
  });
});
