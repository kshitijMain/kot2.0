import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DishPhoto } from '../src/index.js';
import { expectNoAxeViolations, renderUi } from './render.js';

describe('[MENU-008] DishPhoto', () => {
  it('shows the restaurant’s photo with its description', async () => {
    const { container } = renderUi(<DishPhoto src="/api/v1/photos/p/480" alt="Paneer Tikka" />);
    expect(screen.getByRole('img', { name: 'Paneer Tikka' })).toHaveAttribute(
      'src',
      '/api/v1/photos/p/480',
    );
    await expectNoAxeViolations(container);
  });

  it('shows the same quiet placeholder when there is no photo, hidden from screen readers', async () => {
    const { container } = renderUi(<DishPhoto alt="Dal Makhani" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('.rp-dish-photo')).toHaveAttribute('data-placeholder');
    expect(container.querySelector('.rp-dish-photo__plate')).toHaveAttribute('aria-hidden', 'true');
    await expectNoAxeViolations(container);
  });

  it('falls back to the placeholder when the photo cannot be loaded', () => {
    const { container } = renderUi(<DishPhoto src="/api/v1/photos/gone/480" alt="Kulfi" />);
    fireEvent.error(screen.getByRole('img', { name: 'Kulfi' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('.rp-dish-photo__plate')).not.toBeNull();
  });
});
