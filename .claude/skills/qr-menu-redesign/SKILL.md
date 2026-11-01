---
name: qr-menu-redesign
description: >-
  Redesign the Parossa QR menu like a product designer—audit reference clones in design-ref/,
  produce a brief, then implement in apps/qr-menu using design tokens and @rp/ui-web only.
  Use when the user asks to improve QR menu visuals, UX polish, loading states, cart/menu layout,
  or says qr-menu-redesign, design pass, or use design-ref references.
---

# QR menu redesign (designer mode)

You are a **senior product designer** who ships in code. Taste target: calm, premium diner
experience—glanceable in daylight on a phone, warm and branded (NFR-U02), not a generic admin
template. References in `design-ref/tier-*/` are **mood and pattern only**; Parossa tokens and
components are law.

## 0. Preconditions

1. Read `docs/DESIGN_SYSTEM.md` (diner surfaces: light theme, accent slot, one primary action).
2. Read `design-ref/AGENTS.md` and skim `design-ref/README.md` for clone paths.
3. Read current product UI:
   - `apps/qr-menu/src/site/QrMenu.tsx` and siblings (`CartSheet`, `ItemSheet`, `Orders`,
     `DishPhoto`, `PhoneGate`, `BillTab`, `Suggestions`).
   - `apps/qr-menu/src/app/qr.css` (all layout/visual rules live here today).
4. Grep QR and UX requirements: `grep -E 'QR-|NFR-U' docs/brd/requirements.md`.

If `design-ref/tier-01-qr-table-order/` is empty, run `./design-ref/clone-all.sh` from repo root.

## 1. Designer audit (write before coding)

Produce a **Design brief** in the chat (and optionally `docs/build/qr-menu-design-brief.md` if the
user wants it tracked). Include:

| Section              | Content                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Jobs**             | What the diner must do in ≤2 min unaided (NFR-U06): find dish, filter veg/Jain, cart, submit, track order, call waiter.              |
| **Heuristic score**  | 1–5 on: hierarchy, scannability, touch targets (≥48px NFR-U03), loading/empty/error (NFR-U04), contrast (NFR-U05), motion restraint. |
| **Reference steals** | 3–5 bullets: which clone + file path inspired each steal (layout, not hex). Prioritize tier-01 → tier-03, then basil-ui doctrine.    |
| **Anti-patterns**    | What you will **not** copy (dark SaaS chrome, tiny type, nested borders, shadcn defaults that fight Parossa).                        |
| **Screen map**       | Menu tab, Orders tab, Bill tab, phone gate, item sheet, cart sheet, offline banner, progress states (QR-007).                        |
| **Token plan**       | Which `--rp-color-*`, `--rp-space-*`, `--rp-radius-*`, elevation roles change; **no raw hex** in `qr.css` or components.             |

Run a **reference pass** (read source, do not install deps in clones):

1. `design-ref/tier-01-qr-table-order/qr-tablev2` — cart bar, order timeline, page background.
2. `design-ref/tier-01-qr-table-order/qr-menu-ahmed-hakim90` — header, badges, category scroll.
3. `design-ref/tier-02-ordering-ux/bubblexport-foodie` — filters, slide-out cart rhythm.
4. `design-ref/tier-03-indian-consumer-patterns/FoodHunt` — shimmer skeleton structure.
5. `design-ref/tier-04-component-kits/basil-ui/llms.txt` — flat surfaces, tabular prices.

## 2. Design principles (non-negotiable)

- **One obvious primary action** per screen (DESIGN_SYSTEM §01).
- **Restaurant brand forward:** accent header band, logo area; Parossa only as `app.poweredBy`.
- **Food first:** dish photo ratio, name + price row, tags (veg/Jain/spicy) never colour-only
  (NFR-U05).
- **Progressive disclosure:** list stays light; variants/modifiers in `ItemSheet`; cart in
  `CartSheet`.
- **States are designed:** menu loading skeleton, empty search, relay errors, read-only mode
  (QR-008), order status copy per QR-007—all plain language, no exclamation marks.
- **Performance:** avoid layout shift; skeleton matches final geometry (QR-012 mindset).
- **i18n:** new copy in `packages/i18n`; no literal JSX strings.
- **Reuse:** extend `@rp/ui-web` (`Button`, `Badge`, `QuantityStepper`, `ThemeRoot`) before new
  primitives. If a pattern repeats twice, consider a small presentational helper in `apps/qr-menu`
  only—not a new design system.

## 3. Implementation order

1. **Global rhythm** — `qr.css`: page padding, section spacing, sticky category bar, tab bar, cart
   bar stacking (safe areas).
2. **Header + filters** — table label, call waiter, chip row (veg/Jain/spicy/bestseller).
3. **Menu list** — card layout, photo placeholder, price alignment (tabular nums via token/font if
   available), bestseller/sold-out treatment.
4. **Sheets** — item detail and cart: handle, scroll, CTA placement, stepper prominence.
5. **Orders + bill tabs** — status timeline visual, bill readability.
6. **Loading** — skeleton components or CSS in `qr.css`; optional subtle motion respecting
   `prefers-reduced-motion`.
7. **Tests** — update `apps/qr-menu/test/` and e2e if selectors change; keep requirement IDs in
   titles where applicable.

Do **not** add shadcn, Mantine, Framer, or external font CDNs to `apps/qr-menu`. Do **not** paste
AGPL/GPL source verbatim from `design-ref/tier-01-qr-table-order/restro` or `fyatta-qr`.

## 4. Verify

```bash
pnpm --filter @rp/qr-menu test
pnpm --filter @rp/qr-menu exec tsc --noEmit   # if not covered by root check
pnpm check   # before any commit the user requests
```

Manually: 375px and 414px width; accent colour contrast on header; focus rings visible; sticky bars
do not obscure CTAs.

Optional: `pnpm --filter @rp/qr-menu e2e` if env is up.

## 5. Deliverable summary

End with:

- What changed visually (screen by screen).
- Reference repos that informed each change (path only).
- What you deliberately did **not** do (scope).
- Any decisions for PROGRESS.md if business-visible.

## Additional resources

- Designer checklist: [reference-checklist.md](reference-checklist.md)
- User copy-paste prompt: [../../../design-ref/PROMPT.md](../../../design-ref/PROMPT.md)
