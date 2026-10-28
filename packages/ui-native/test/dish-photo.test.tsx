import { fireEvent, screen } from '@testing-library/react-native';
import { DishPhoto } from '../src/index.js';
import { renderUi } from './render.js';

describe('[MENU-008] DishPhoto', () => {
  it('shows the restaurant’s photo, described for screen readers', async () => {
    await renderUi(
      <DishPhoto source={{ uri: 'http://pos.test/p/480' }} alt="Paneer Tikka" testID="photo" />,
    );
    expect(screen.getByLabelText('Paneer Tikka')).toBeOnTheScreen();
    expect(screen.queryByTestId('photo-placeholder')).toBeNull();
  });

  it('shows the placeholder plate without a photo, hidden from screen readers', async () => {
    await renderUi(<DishPhoto alt="Dal Makhani" testID="photo" />);
    expect(screen.queryByLabelText('Dal Makhani')).toBeNull();
    expect(screen.getByTestId('photo-placeholder', { includeHiddenElements: true })).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
  });

  it('falls back to the placeholder when the photo cannot be loaded', async () => {
    await renderUi(
      <DishPhoto source={{ uri: 'http://pos.test/gone' }} alt="Kulfi" testID="photo" />,
    );
    await fireEvent(screen.getByLabelText('Kulfi'), 'error');
    expect(screen.getByTestId('photo-placeholder', { includeHiddenElements: true })).toBeTruthy();
  });
});
