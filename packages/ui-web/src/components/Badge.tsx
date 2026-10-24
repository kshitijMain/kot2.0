import type { Tone } from '@rp/design-tokens';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../internal/cx.js';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** A status tone, or `highlight`: the brand's saffron for labels that are not a status. */
  tone?: Tone | 'highlight';
  /** `subtle` (tinted) for labels, `solid` for counts that must catch the eye. */
  variant?: 'subtle' | 'solid';
  icon?: ReactNode;
}

/** Small label or count. Its text carries the meaning; the colour only reinforces it (NFR-U05). */
export function Badge({
  tone = 'neutral',
  variant = 'subtle',
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span {...rest} data-tone={tone} data-variant={variant} className={cx('rp-badge', className)}>
      {icon}
      {children}
    </span>
  );
}
