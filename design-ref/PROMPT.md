# Copy-paste prompt for Claude Code

Invoke the skill first (recommended):

```
/qr-menu-redesign
```

Or paste everything below the line into Claude Code in the `new-kot` repo root.

---

## Prompt

You are redesigning the **Parossa QR menu** (`apps/qr-menu`) like a **senior product designer** who implements in code—not a theme swap, a coherent diner experience for Indian restaurants (Mannat pilot: table QR, veg/Jain filters, photos, cart, orders, bill, call waiter).

**Follow the project skill:** read and execute `.claude/skills/qr-menu-redesign/SKILL.md` end to end.

**Reference library:** shallow clones live under `design-ref/tier-*/`. Read `design-ref/AGENTS.md` and `design-ref/README.md`. Study source in those folders (especially tier-01 `qr-tablev2`, `qr-menu-ahmed-hakim90`, tier-02 `bubblexport-foodie`, tier-03 `FoodHunt`, tier-04 `basil-ui/llms.txt`). Do **not** `pnpm install` inside every clone. Do **not** import shadcn/Mantine/external fonts into our app—translate patterns into `apps/qr-menu/src/app/qr.css` and `@rp/ui-web` using **`docs/DESIGN_SYSTEM.md`** and `packages/design-tokens`.

**Product sources of truth (read before changing UI):**

- `apps/qr-menu/src/site/QrMenu.tsx` and related site components
- `apps/qr-menu/src/app/qr.css`
- BRD UX: `grep -E 'QR-|NFR-U' docs/brd/requirements.md`

**Your workflow:**

1. **Audit** the current UI as a designer (hierarchy, spacing, cards, buttons, tabs, sheets, loading, empty/error, order status). Score heuristics 1–5.
2. **Write a short design brief** in chat: jobs-to-be-done, 3–5 reference steals (repo + file path), anti-patterns to avoid, screen-by-screen plan, token/elevation plan (no raw hex).
3. **Implement** in this order: global rhythm → header/filters → menu cards → ItemSheet/CartSheet → Orders/Bill tabs → loading skeletons → i18n strings in `packages/i18n`.
4. **Verify:** `pnpm --filter @rp/qr-menu test` and `pnpm check` before stopping.
5. **Summarize** what changed, which references informed it, and anything deferred.

**Constraints:** Money stays server-authoritative; no business logic in JSX; plain error copy without exclamation marks; WCAG AA; touch targets ≥48px; restaurant accent on diner surfaces (NFR-U02). License-safe: pattern-only from AGPL/GPL clones.

**Goal:** What we see on the phone after scanning the table QR should feel **intentionally designed**—warm, scannable, confident CTAs, polished loading and order states—not a functional prototype.

Do not ask me to choose between options unless a **business rule** truly changes; pick the reading that matches the BRD and DESIGN_SYSTEM, document it, and keep building until the pass is complete.
