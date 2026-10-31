# Design reference library (local only)

This directory is **gitignored**. It holds shallow clones of open-source restaurant / QR-menu /
food-ordering UIs for **visual and interaction reference** when improving `apps/qr-menu`.

## Rules when using these repos

1. **Parossa wins:** Implement against `docs/DESIGN_SYSTEM.md`, `packages/design-tokens`, and
   `@rp/ui-web`. Do not copy hex colours, fonts, or third-party component libraries into product
   code unless an ADR says otherwise.
2. **QR menu constraints:** Respect BRD/QR requirements (e.g. QR-013: no arbitrary external web
   fonts or hotlinked assets in the shipped QR app). Reference repos may violate that; our app
   must not.
3. **Licenses:** Some clones are MIT; others are AGPL/GPL or have no clear license. Use them to
   **study layout and UX**, not to paste large code blocks, unless license and scope are verified.
4. **No installs required:** Do not `pnpm install` inside every clone unless you are spelunking
   one repo. Read source: `src/`, `app/`, `components/`, `globals.css`, Storybook/docs.

## Where our product lives

| Area                  | Path                                   |
| --------------------- | -------------------------------------- |
| QR menu UI            | `apps/qr-menu/src/site/`               |
| QR-specific CSS       | `apps/qr-menu/src/app/qr.css`          |
| Shared web components | `packages/ui-web/`                     |
| Tokens                | `packages/design-tokens/src/themes.ts` |
| Design system doc     | `docs/DESIGN_SYSTEM.md`                |

## How to navigate this library

- Start with **`tier-01-qr-table-order/`** for flows closest to scan → menu → cart → orders.
- Use **`tier-02-ordering-ux/`** for cart sheets, filters, item detail, checkout polish.
- Use **`tier-03-indian-consumer-patterns/`** for shimmer lists and menu card density.
- Read **`basil-ui/`** (in tier-04) for `llms.txt` and flat F&B UI doctrine.
- Use **`tier-05-motion-loading/`** for skeletons and Lottie patterns (reimplement in our stack).
- Use **`tier-06-marketing-menu-layout/`** for hero/menu typography ideas.

See **`README.md`** for the full catalogue, key paths per repo, and clone refresh commands.

## Suggested review order for a QR redesign

1. `tier-01-qr-table-order/qr-tablev2` — table route, cart bar, order status, Tailwind tokens
2. `tier-01-qr-table-order/qr-menu-ahmed-hakim90` — public menu, badges, Framer Motion
3. `tier-02-ordering-ux/bubblexport-foodie` — dietary filters, slide-out cart
4. `tier-03-indian-consumer-patterns/FoodHunt` — shimmer matching list layout
5. `tier-04-component-kits/basil-ui` — agent-friendly component rules
