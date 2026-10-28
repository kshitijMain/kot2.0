import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as LoginModule from '../src/screens/LoginScreen.js';
import { expectNoAxeViolations, renderConsole, t } from './harness.js';

/** Whether the mocked login screen throws while it renders (a bug in a screen). */
const crash = vi.hoisted(() => ({ on: true }));

vi.mock('../src/screens/LoginScreen.js', async (importOriginal) => {
  const actual = await importOriginal<typeof LoginModule>();
  return {
    LoginScreen: () => {
      if (crash.on) throw new Error('A screen bug');
      return <actual.LoginScreen />;
    },
  };
});

describe('[NFR-U04] [NFR-A03] a screen that crashes (QA audit, category A)', () => {
  it('shows a plain message with a way back instead of a white page', async () => {
    crash.on = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, container } = await renderConsole();
    expect(await screen.findByText(t('states.crashTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('states.crashDescription'))).toBeInTheDocument();
    await expectNoAxeViolations(container);
    crash.on = false;
    await user.click(screen.getByRole('button', { name: t('states.retry') }));
    expect(await screen.findByRole('heading', { name: t('login.title') })).toBeInTheDocument();
    errors.mockRestore();
  });
});
