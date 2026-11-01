# QR menu redesign — designer checklist

Use while auditing and before marking work done.

## Hierarchy

- [ ] Restaurant name / table readable in one glance at arm's length
- [ ] Category chips distinguish active section without relying on colour alone
- [ ] Price column or trailing price aligns across items (tabular numbers)
- [ ] Primary CTA (Add / View cart / Place order) dominates; secondary actions are ghost/outline

## Touch & layout (mobile first)

- [ ] Interactive targets ≥ 48px (NFR-U03)
- [ ] Bottom tab bar + cart bar + safe-area insets do not overlap
- [ ] No horizontal page scroll; chip rows scroll inside their track only
- [ ] Sticky header/chips behave when scrolling long menus

## Content & trust

- [ ] Veg / Jain / spicy / bestseller tags visible and accessible
- [ ] Sold-out or unavailable items clearly disabled, not hidden without explanation
- [ ] Privacy/terms link present (QR-013)
- [ ] Offline / read-only banner distinct from error toast (QR-008)

## Order journey (QR-007)

- [ ] Loading menu: skeleton, not blank screen
- [ ] Submit progress states use approved copy patterns
- [ ] Orders tab shows status at item level where required
- [ ] Call waiter / request bill discoverable (QR-011)

## Visual system

- [ ] Only `--rp-*` tokens and `@rp/ui-web` roles; contrast tests still pass
- [ ] Accent = restaurant brand; teal primary for actions per DESIGN_SYSTEM
- [ ] Shadows only on floating layers (sheets, bars), not every card—match Parossa elevation tokens
- [ ] `prefers-reduced-motion` respected for any animation

## Engineering

- [ ] Strings in `packages/i18n`
- [ ] Tests updated for structural/DOM changes
- [ ] No secrets, no new tracking scripts
