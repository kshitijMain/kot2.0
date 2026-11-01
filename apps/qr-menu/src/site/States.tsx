'use client';

import { Button, Icon, type IconName } from '@rp/ui-web';

/**
 * An empty state that says what to do next (P9-11, NFR-U04). Presentational only; the words come
 * from the caller. The skeletons are in ./Skeletons (no client code, for the loading route).
 */

export function QrEmpty({
  icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: IconName;
  title: string;
  body: string;
  /** The way on, e.g. "Browse the menu". */
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="qr-empty-state">
      <span className="qr-empty-state__icon" aria-hidden="true">
        <Icon name={icon} size="1.75rem" />
      </span>
      <p className="qr-empty-state__title">{title}</p>
      <p className="qr-muted">{body}</p>
      {action === undefined || onAction === undefined ? null : (
        <Button variant="secondary" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}
