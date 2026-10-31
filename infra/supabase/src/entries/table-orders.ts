// Supabase entry of the `table-orders` function (bundled by scripts/bundle-functions.mjs).
import { serve } from '../deno/serve.js';
import { tableOrders } from '../table-orders.js';

serve(tableOrders);
