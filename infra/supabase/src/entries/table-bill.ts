// Supabase entry of the `table-bill` function (bundled by scripts/bundle-functions.mjs).
import { serve } from '../deno/serve.js';
import { tableBill } from '../table-bill.js';

serve(tableBill);
