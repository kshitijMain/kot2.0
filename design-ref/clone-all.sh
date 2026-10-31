#!/usr/bin/env bash
# Shallow-clone design reference repos into tier folders. Safe to re-run (skips existing).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

clone_one() {
  local dir="$1"
  local url="$2"
  if [[ -d "$dir/.git" ]]; then
    echo "skip (exists): $dir"
    return 0
  fi
  mkdir -p "$(dirname "$dir")"
  echo "clone: $dir <- $url"
  git clone --depth 1 "$url" "$dir" || echo "FAILED: $url"
}

# tier-01-qr-table-order
clone_one tier-01-qr-table-order/qr-tablev2 https://github.com/hnkatze/qr-tablev2.git
clone_one tier-01-qr-table-order/qr-menu-ahmed-hakim90 https://github.com/ahmed-hakim90/qr-menu.git
clone_one tier-01-qr-table-order/FeastQR https://github.com/charnowsky/FeastQR.git
clone_one tier-01-qr-table-order/menufic https://github.com/kaje94/menufic.git
clone_one tier-01-qr-table-order/qr-asia https://github.com/chatman-media/qr-asia.git
clone_one tier-01-qr-table-order/restro https://github.com/elitale/restro.git
clone_one tier-01-qr-table-order/ma-menu https://github.com/surya-sirisolla/ma-menu.git
clone_one tier-01-qr-table-order/RestroQR https://github.com/KartikSharma4448/RestroQR.git

# tier-02-ordering-ux
clone_one tier-02-ordering-ux/bubblexport-foodie https://github.com/abhibavishi/bubblexport-foodie.git
clone_one tier-02-ordering-ux/restaurant-storefront-starter https://github.com/craveup/restaurant-storefront-starter.git
clone_one tier-02-ordering-ux/chinese-restaurant-storefront https://github.com/craveup/chinese-restaurant-storefront.git
clone_one tier-02-ordering-ux/Food_Delivery_Website https://github.com/RayuduBharani/Food_Delivery_Website.git
clone_one tier-02-ordering-ux/menyu https://github.com/AMWolfstein/menyu.git

# tier-03-indian-consumer-patterns
clone_one tier-03-indian-consumer-patterns/FoodHunt https://github.com/DineshRout779/FoodHunt.git
clone_one tier-03-indian-consumer-patterns/FoodPeek https://github.com/droidbg/FoodPeek.git
clone_one tier-03-indian-consumer-patterns/namaste-food https://github.com/g3vind/namaste-food.git
clone_one tier-03-indian-consumer-patterns/Food-app https://github.com/vaibhav-madan-20/Food-app.git

# tier-04-component-kits
clone_one tier-04-component-kits/basil-ui https://github.com/sonhoai27/basil-ui.git
clone_one tier-04-component-kits/simpos https://github.com/hieuhani/simpos.git
clone_one tier-04-component-kits/openfront-restaurant https://github.com/openshiporg/openfront-restaurant.git

# tier-05-motion-loading
clone_one tier-05-motion-loading/react-next-loader https://github.com/yogeshgabani/react-next-loader.git
clone_one tier-05-motion-loading/EFood_Restaurant https://github.com/AsrielDreemurrGM/EFood_Restaurant.git
clone_one tier-05-motion-loading/ui-web-fast-food https://github.com/sonht113/ui-web-fast-food.git

# tier-06-marketing-menu-layout
clone_one tier-06-marketing-menu-layout/tablefork-nextjs-restaurant-template https://github.com/haider484991/tablefork-nextjs-restaurant-template.git
clone_one tier-06-marketing-menu-layout/codemenu https://github.com/swlarot/codemenu.git
clone_one tier-06-marketing-menu-layout/VITE-SHADCN-MERN-RestaurantWebsite https://github.com/nishkarsh25/VITE-SHADCN-MERN-ZOD-ZUSTAND-RestaurantWebsite.git

# tier-07-other
clone_one tier-07-other/digital-menu https://github.com/amratansh12/digital-menu.git
clone_one tier-07-other/fyatta-qr https://github.com/sulav-codes/fyatta-qr.git

echo "Done. See design-ref/README.md and design-ref/AGENTS.md"
