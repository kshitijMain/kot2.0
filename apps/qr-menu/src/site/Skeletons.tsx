import type { ReactNode } from 'react';

/**
 * Skeletons the same shape as what they stand for, so nothing jumps when it arrives (P9-11,
 * QR-012). Plain markup with no client code: the server's loading route uses them too.
 */

/** Grey blocks where text will be; their widths come from the stylesheet. */
function Lines({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="qr-skeleton__line" />
      ))}
    </>
  );
}

/** Dish rows as they will be: name, price, a line of description, the action column. */
export function DishSkeletons({ count = 4 }: { count?: number }) {
  return (
    <ul className="qr-dishes" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="qr-dish qr-skeleton">
          <div className="qr-dish__what">
            <Lines count={3} />
          </div>
          <div className="qr-dish__side">
            <span className="qr-skeleton__block qr-skeleton__action" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A card of lines (an order, a bill) while it is looked up; the label says so to screen readers. */
export function CardSkeleton({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="qr-card-skeleton qr-skeleton" role="status">
      <span className="qr-visually-hidden">{label}</span>
      <Lines count={4} />
      {children}
    </div>
  );
}
