import { nativeFontFamily, nativeHeadingFontFamily } from '@rp/design-tokens';
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

/** Text in the brand's font, the serif for headers (ADR-0028). A style the caller gives still wins. */
export function Text({ style, ...rest }: TextProps) {
  const fontFamily =
    rest.accessibilityRole === 'header' ? nativeHeadingFontFamily : nativeFontFamily;
  return <NativeText {...rest} style={[{ fontFamily }, style]} />;
}

/** A text input in the brand's font, so typed text matches the labels around it. */
export function TextInput({ style, ...rest }: TextInputProps) {
  return <NativeTextInput {...rest} style={[{ fontFamily: nativeFontFamily }, style]} />;
}
