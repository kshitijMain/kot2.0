# design-ref

Local-only reference clones for QR menu and diner-surface design work. Not committed to git.

**Claude Code:** run skill `/qr-menu-redesign` or paste the prompt from [`PROMPT.md`](PROMPT.md).
Skill definition: `.claude/skills/qr-menu-redesign/SKILL.md`.

Refresh all shallow clones:

```bash
./design-ref/refresh-clones.sh
```

Initial clone (first time):

```bash
./design-ref/clone-all.sh
```

## Catalogue

### tier-01-qr-table-order

| Folder                  | Upstream                  | Focus paths                                               |
| ----------------------- | ------------------------- | --------------------------------------------------------- |
| `qr-tablev2`            | hnkatze/qr-tablev2        | `src/app/r/`, `src/app/globals.css`, `src/components/ui/` |
| `qr-menu-ahmed-hakim90` | ahmed-hakim90/qr-menu     | public menu + `src/components/`                           |
| `FeastQR`               | charnowsky/FeastQR        | QR cards, public menu, shadcn UI                          |
| `menufic`               | kaje94/menufic            | themes, banners, menu layout (Mantine)                    |
| `qr-asia`               | chatman-media/qr-asia     | client web menu, category nav                             |
| `restro`                | elitale/restro            | guest self-order, GST UI (**AGPL**)                       |
| `ma-menu`               | surya-sirisolla/ma-menu   | table QR, order lifecycle                                 |
| `RestroQR`              | KartikSharma4448/RestroQR | customer Next site + table order                          |

### tier-02-ordering-ux

| Folder                          | Upstream                                                          | Focus paths                                   |
| ------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| `bubblexport-foodie`            | abhibavishi/bubblexport-foodie                                    | `src/app/menu/`, cart, filters                |
| `restaurant-storefront-starter` | craveup/restaurant-storefront-starter                             | sticky nav, product dialog/drawer             |
| `chinese-restaurant-storefront` | craveup/chinese-restaurant-storefront                             | theme JSON, mobile drawer                     |
| `Food_Delivery_Website`         | RayuduBharani/Food_Delivery_Website                               | `Frontend/src/components/LoadingSkeleton.tsx` |
| `menyu`                         | AMWolfstein/menyu (fork; upstream dvlinuxx-max often unavailable) | `CategoryNav.tsx`, `MenuItemCard.tsx`         |

### tier-03-indian-consumer-patterns

| Folder         | Upstream                  | Focus paths               |
| -------------- | ------------------------- | ------------------------- |
| `FoodHunt`     | DineshRout779/FoodHunt    | shimmer, restaurant list  |
| `FoodPeek`     | droidbg/FoodPeek          | shimmer, search           |
| `namaste-food` | g3vind/namaste-food       | lazy load, toasts         |
| `Food-app`     | vaibhav-madan-20/Food-app | RestaurantCard, menu body |

### tier-04-component-kits

| Folder                 | Upstream                         | Focus paths                                       |
| ---------------------- | -------------------------------- | ------------------------------------------------- |
| `basil-ui`             | sonhoai27/basil-ui               | `llms.txt`, `AGENTS.md`, `src/styles/globals.css` |
| `simpos`               | hieuhani/simpos                  | Chakra POS layouts                                |
| `openfront-restaurant` | openshiporg/openfront-restaurant | POS/KDS/menu engineering UI                       |

### tier-05-motion-loading

| Folder              | Upstream                          | Focus paths           |
| ------------------- | --------------------------------- | --------------------- |
| `react-next-loader` | yogeshgabani/react-next-loader    | skeleton variants     |
| `EFood_Restaurant`  | AsrielDreemurrGM/EFood_Restaurant | Lottie loading        |
| `ui-web-fast-food`  | sonht113/ui-web-fast-food         | `public/` Lottie JSON |

### tier-06-marketing-menu-layout

| Folder                                 | Upstream                                                   | Focus paths                        |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| `tablefork-nextjs-restaurant-template` | haider484991/tablefork-nextjs-restaurant-template          | `config/site.ts`, menu HTML layout |
| `codemenu`                             | swlarot/codemenu                                           | fine-dining typography mood        |
| `VITE-SHADCN-MERN-RestaurantWebsite`   | nishkarsh25/VITE-SHADCN-MERN-ZOD-ZUSTAND-RestaurantWebsite | shadcn food delivery UI            |

### tier-07-other

| Folder         | Upstream                 | Notes                           |
| -------------- | ------------------------ | ------------------------------- |
| `digital-menu` | amratansh12/digital-menu | Vite + shadcn user menu flow    |
| `fyatta-qr`    | sulav-codes/fyatta-qr    | real-time QR ordering (**GPL**) |

## External assets (not cloned)

- [LottieFiles food loading](https://lottiefiles.com/free-animation/food-loading-B3EpGFc2o6) — download JSON into product repo if adopted; check license.
