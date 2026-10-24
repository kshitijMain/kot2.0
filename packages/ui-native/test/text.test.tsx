import { nativeFontFamily } from '@rp/design-tokens';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Text, TextField, TextInput } from '../src/index.js';
import { renderUi } from './render.js';

describe('[NFR-U01] the brand font', () => {
  it('sets Inter on text and inputs, and lets a given style win', async () => {
    await render(
      <>
        <Text testID="plain">Table 4</Text>
        <Text testID="mono" style={{ fontFamily: 'monospace', fontSize: 20 }}>
          KOT 12
        </Text>
        <TextInput testID="input" value="Ravi" />
      </>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('plain').props.style)).toMatchObject({
      fontFamily: nativeFontFamily,
    });
    expect(StyleSheet.flatten(screen.getByTestId('mono').props.style)).toMatchObject({
      fontFamily: 'monospace',
      fontSize: 20,
    });
    expect(StyleSheet.flatten(screen.getByTestId('input').props.style)).toMatchObject({
      fontFamily: nativeFontFamily,
    });
  });

  it('types into a text field in the same font as its label', async () => {
    await renderUi(<TextField label="Search the menu" value="" onChangeText={() => undefined} />);
    expect(StyleSheet.flatten(screen.getByLabelText('Search the menu').props.style)).toMatchObject({
      fontFamily: nativeFontFamily,
    });
    expect(StyleSheet.flatten(screen.getByText('Search the menu').props.style)).toMatchObject({
      fontFamily: nativeFontFamily,
    });
  });
});
