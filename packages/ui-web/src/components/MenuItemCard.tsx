import { formatRupees, type Paise } from '@rp/domain';
import { cx } from '../internal/cx.js';
import { DishPhoto } from './DishPhoto.js';
import { Money } from './Money.js';

export type FoodType = 'VEG' | 'NON_VEG' | 'EGG';

export interface MenuItemCardProps {
  name: string;
  price: Paise;
  foodType: FoodType;
  /** The food type in words, e.g. "Veg" (the mark alone is not enough, NFR-U05). */
  foodTypeLabel: string;
  /** A short note, e.g. "Choose options", "Combo" or "5 left". */
  note?: string;
  /** Why it cannot be ordered, e.g. "Sold out"; the card is then disabled. */
  unavailable?: string;
  onSelect?: () => void;
  className?: string;
  /**
   * The dish's photo beside its name: an address, or null for the placeholder. Left out, the
   * card has no photo area at all.
   */
  photo?: string | null;
}

/**
 * One dish on an ordering screen (MENU-012): name, price, the veg/non-veg/egg mark and a note, as
 * a large touch target (NFR-U03), with the dish's photo (or the placeholder) when given (MENU-008).
 * Shared by the POS and the QR menu; the same selection rules come from `@rp/domain`
 * menu-selection on every surface.
 */
export function MenuItemCard({
  name,
  price,
  foodType,
  foodTypeLabel,
  note,
  unavailable,
  onSelect,
  className,
  photo,
}: MenuItemCardProps) {
  const spoken = [name, formatRupees(price), foodTypeLabel, unavailable ?? note].filter(
    (part): part is string => part !== undefined,
  );
  const details = (
    <>
      <span className="rp-menu-item__top">
        <span className="rp-food-mark" data-food={foodType} title={foodTypeLabel} />
        <span className="rp-menu-item__name">{name}</span>
      </span>
      <Money paise={price} className="rp-menu-item__price" />
      {unavailable === undefined ? (
        note === undefined ? null : (
          <span className="rp-menu-item__note">{note}</span>
        )
      ) : (
        <span className="rp-menu-item__note" data-unavailable>
          {unavailable}
        </span>
      )}
    </>
  );
  return (
    <button
      type="button"
      aria-label={spoken.join(', ')}
      disabled={unavailable !== undefined}
      data-food={foodType}
      onClick={onSelect}
      className={cx('rp-menu-item', photo !== undefined && 'rp-menu-item--photo', className)}
    >
      {photo === undefined ? (
        details
      ) : (
        <>
          {/* The card's label names the dish, so the photo itself is decorative here. */}
          <DishPhoto src={photo ?? undefined} alt="" className="rp-menu-item__photo" />
          <span className="rp-menu-item__body">{details}</span>
        </>
      )}
    </button>
  );
}
