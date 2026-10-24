# ADR-0022: Parossa brand, Inter and a light kitchen display

Status: Accepted
Date: 2026-10-24
Work package: none (a redesign the Business Owner asked for on 2026-10-24)
Requirements: KDS-011, NFR-U01, NFR-U02, NFR-U03, NFR-U05, NFR-A01, NFR-L02

## Context

The Business Owner named the product Parossa (OI-01 had left "Restaurant Operations Platform" as a
working name) and asked for a lighter, calmer look on every staff screen: an off-white page, white
cards with soft shadows, teal for actions and saffron for highlights, with Inter as the typeface.
The logo files are in `brand/parossa`.

Three things in the existing system stood in the way:

- KDS-011 and NFR-U02 say the kitchen display is dark by default. The Business Owner wants it light
  by default, readable from 2 m, with the dark theme kept for a manager to switch on.
- ADR-0009 allows system fonts only, so that every screen renders offline (NFR-A01).
- The `warning` tone was `#b45309`, the darker saffron the brief suggests for text, so a brand
  highlight and a warning would have looked the same.

## Decision

Brand:

- The product's name is Parossa; the waiter app is Parossa Captain, the table tablet Parossa Table
  and the vendor web app Parossa Control Plane. Only names people see change: the Windows install
  folder, app id, service ids and setup file name, the Android package ids and Expo slugs, the LAN
  CA's subject and the `@rp/` package scope stay, because installed PCs, devices, updates and
  certificates are found by them. The Windows installer's own wizard title keeps the install name;
  it changes only with `productName`, which moves the install folder.
- The logo is on the console's header, pairing, sign-in and first-run screens and on the phones'
  and tablet's pairing and sign-in screens. The apps use `brand/parossa`'s icon, adaptive icon and
  splash files on a `#FAF7F2` background.
- Screens diners see (table tablet, QR menu) keep the restaurant's logo and accent colour
  (NFR-U02). Parossa appears there only as a small "Powered by Parossa" line.

Colours (`packages/design-tokens/src/themes.ts`):

- Light: page `#faf7f2`, white surfaces, primary teal `#0f766e` (hover `#115e59`, pressed
  `#134e4a`). New roles `highlight` (saffron `#f7931e`, with dark text on it), `highlightSubtle`
  and `highlightText` (`#a64b08`) for selected items, badges and the bar under page titles. The
  saffron fill is never the only sign of anything; a chosen option also gets a dark-saffron ring.
  `#a64b08` replaces the suggested `#b45309`, which is only 4.38:1 on the input background.
- Status tones move away from the brand: warning to ochre `#a16207`, info to blue `#1d4ed8`;
  success stays green and danger red. A test checks that no tone equals a brand colour.
- `accent` remains the restaurant's colour slot and defaults to the primary.

Kitchen display:

- Four themes: `light`, `dark`, `kds` (now light: near-black text on warm white, AAA text) and
  `kds-dark` (the former near-black theme). Both kitchen themes have the large type and 64 px
  touch targets.
- The kitchen display is light by default. The setting `kds.theme` (`LIGHT` or `DARK`,
  `OPERATIONS_CONFIGURE`) chooses; it reaches the screen with its tickets (`KdsSettings.theme`)
  and changes it at once through `SettingsChanged`. This changes KDS-011's and NFR-U02's default,
  at the Business Owner's request; readability from 2 m and the touch targets are unchanged.
- The console is pinned to the light theme instead of following the operating system.

Type:

- Inter 4.1 (SIL Open Font License) is bundled, never downloaded: the variable WOFF2 in
  `@rp/ui-web` (`src/styles/fonts/`, `font-display: swap`, system faces as fallback) and four
  static TTFs (400 to 700) in `@rp/ui-native/fonts`, built into each APK by the `expo-font` config
  plugin as one family `Inter`. The files are vendored with their licence instead of added as an
  npm dependency, so the licence policy for dependencies is unchanged. ADR-0009's "system fonts
  only" is replaced by this; its reason (nothing downloaded) still holds.
- `@rp/ui-native` exports `Text` and `TextInput` that set Inter under any given style; the apps
  and the shell import `Text` from there. An APK built before this falls back to Roboto.

Shape: radii 6 / 10 / 14 / 20 px, softer warm shadows, and cards that use a shadow and a hairline
border instead of 2 px outlines. Controls keep a 1 px outline of at least 3:1.

## Alternatives considered

- Keep the KDS dark by default and offer light as the option: what the BRD says, but not what the
  Business Owner asked for.
- System fonts only (ADR-0009): smaller and simpler, but Segoe UI and Roboto would make the
  console and the phones look different, and the wordmark is drawn from Inter.
- Inter from npm (`@fontsource-variable/inter`): its OFL licence is not on the dependency
  allow-list, and the package would bring several subsets we do not need.
- Saffron as the primary colour: too light for white text, and it would collide with warnings.

## Consequences

- New APKs are needed for the app names, icons, splash and Inter on Android; everything else
  reaches the phones as an over-the-air update or with the next server update.
- The web bundle carries a 352 KB font file, cached after the first load. The QR menu's first
  paint does not wait for it (`swap`).
- A colour change is still one edit in `themes.ts`, guarded by the contrast tests, which now also
  cover `kds-dark`, the saffron roles and the separation of status and brand colours.
