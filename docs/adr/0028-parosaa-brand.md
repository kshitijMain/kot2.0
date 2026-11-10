# ADR-0028: The Parosaa brand: saffron, deep ink, cream, Playfair Display

Status: Accepted
Date: 2026-11-10
Work package: brand change requested by the Business Owner (2026-11-09)
Requirements: NFR-U01, NFR-U02, NFR-U05, NFR-A01, KDS-011

Replaces the name, palette and logo of ADR-0022. ADR-0022's decision to make the kitchen display
light by default still stands.

## Context

The product's name is spelled Parosaa, and the Business Owner supplied a new logo and a new visual
identity to replace the teal and off-white look. The apps must still work without internet and
keep their contrast guarantees. `apps/table-tablet` is not in use and was not to be edited.

## Decision

- **Name.** Parosaa everywhere people see it; the waiter app is Parosaa Captain. The test restaurant
  formerly called Mannat is also called Parosaa, as are its scripts and database (`rp_parosaa`).
- **Logos.** Clean vector redraws of the owner's two images, in `brand/parosaa`.
- **Colour** (`packages/design-tokens/src/themes.ts`):
  - saffron `#E8821E` for main actions and selected states, always with deep ink text;
  - gold `#F5A623` for icons, thin dividers (`divider`) and accents on dark surfaces;
  - deep ink `#20223D` for text and dark surfaces, replacing pure black;
  - royal indigo `#1B2A6B` for links and data (`link`);
  - warm cream `#FBF7F0` pages and white cards;
  - teal only for small success marks.
- **Where the requested colours failed contrast**, the closest passing shade is used: success fills
  `#1AA26E` (teal `#1DB47A` is 2.5:1 on cream), success text `#0F7550`, saffron-coloured text
  `#9A5410` (saffron is 2.57:1 on cream). Warning and danger stay distinct from saffron.
- **Accent text.** `brandTextColor` picks deep ink or white, or the near-black `#05060C` on the few
  mid-tone restaurant accents where neither reaches AA.
- **Type.** Inter for body and controls, Playfair Display for headings and table numbers (bold or
  extra bold, with lining figures so they read from 2 m), JetBrains Mono for codes and on-screen
  receipts. All three are bundled (self-hosted WOFF2 on the web, TTF in the APK), so nothing is
  fetched at run time. Printed thermal receipts keep the printer's own font.
- **Shape and motion.** Corners of 6 px (inputs, chips), 10 px (buttons), 14 px (cards, sheets,
  dialogs). Transitions of 150 to 200 ms, none when the device asks for reduced motion.

## Kept on purpose

Identifiers whose renaming would break things already installed: the mDNS service
`_parossa-pos._tcp`, the Android packages `in.rp.*`, the Expo slug and the Windows service and
firewall ids. `apps/table-tablet` keeps its own name, assets and black-or-white helper
(`readableTextColor`), and picks up the shared tokens and components.

## Alternatives considered

- White text on saffron: fails contrast (2.75:1), rejected by the Business Owner's brief as well.
- The requested teal unchanged for status fills: fails the 3:1 indicator test on cream.
- Loading fonts from Google: the restaurant must work without internet (NFR-A01).

## Consequences

- A pilot set up under the old restaurant name is not migrated: `setup` creates a new Parosaa
  restaurant beside it, with new QR codes.
- An APK has to be rebuilt to get the new icon and fonts; the tablet falls back to the system font
  for headings because its own build settings were left alone.
