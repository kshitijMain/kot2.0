import { photoUrl } from '@rp/contracts';
import { DishPhoto, MenuItemCard, Money } from '@rp/ui-web';
import { useT } from '../../app/i18n.js';

/** What the preview shows of a dish, as the form has it now (not yet saved or published). */
export interface PreviewDish {
  readonly name: string;
  /** Paise: the price the menu shows, "from" the cheapest size when it has sizes. */
  readonly price: number;
  readonly foodType: 'VEG' | 'NON_VEG' | 'EGG';
  readonly spiceLevel: number;
  readonly tags: readonly string[];
  readonly description: string;
  readonly photoId: string | null;
  /** It opens a sheet to choose a size, add-ons or a combo's dishes. */
  readonly needsChoice: boolean;
}

/**
 * How a dish will look on the waiter phone and the table tablet once published (MENU-012), next to
 * the form so the manager sees it while typing. The phone shows the shared menu card (the native
 * `MenuItemCard` is its twin); the tablet shows its photo, or the same placeholder, as its dish
 * card does (`apps/table-tablet/src/DishCard.tsx`).
 */
export function DishPreview({ dish }: { dish: PreviewDish }) {
  const t = useT();
  const name = dish.name.trim() === '' ? t('menuEditor.item.previewName') : dish.name.trim();
  const foodTypeLabel = t(`pos.menu.foodType.${dish.foodType}`);
  const facts = [
    foodTypeLabel,
    dish.spiceLevel > 0 ? t('mobile.tablet.ordering.spice', { level: dish.spiceLevel }) : '',
    ...dish.tags,
  ]
    .filter((fact) => fact !== '')
    .join(' · ');
  return (
    <section className="dish-preview" aria-label={t('menuEditor.item.preview')}>
      <p className="menu-form__hint">{t('menuEditor.item.previewHint')}</p>
      <div className="dish-preview__devices">
        <figure className="dish-preview__device dish-preview__device--phone">
          <figcaption className="dish-preview__caption">
            {t('menuEditor.item.previewPhone')}
          </figcaption>
          <div className="dish-preview__screen" inert>
            <MenuItemCard
              name={name}
              price={dish.price}
              foodType={dish.foodType}
              foodTypeLabel={foodTypeLabel}
              {...(dish.needsChoice && { note: t('menuEditor.item.previewChoose') })}
            />
          </div>
        </figure>
        <figure className="dish-preview__device dish-preview__device--tablet">
          <figcaption className="dish-preview__caption">
            {t('menuEditor.item.previewTablet')}
          </figcaption>
          <div className="dish-preview__screen" inert>
            <article className="dish-preview__card">
              <DishPhoto
                src={dish.photoId === null ? undefined : photoUrl(dish.photoId, 480)}
                alt=""
                className="dish-preview__photo"
              />
              <div className="dish-preview__body">
                <p className="dish-preview__name">
                  <span className="rp-food-mark" data-food={dish.foodType} />
                  <span>{name}</span>
                </p>
                <p className="dish-preview__facts">{facts}</p>
                {dish.description.trim() === '' ? null : (
                  <p className="dish-preview__facts">{dish.description.trim()}</p>
                )}
                <Money paise={dish.price} className="dish-preview__price" />
              </div>
            </article>
          </div>
        </figure>
      </div>
    </section>
  );
}
