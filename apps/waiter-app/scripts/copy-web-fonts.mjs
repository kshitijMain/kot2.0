// Copies Inter from @rp/ui-native into public/fonts before the web build (P9-28, ADR-0022): the
// browser loads the same faces the APK has built in, from the restaurant PC, never the internet.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(app, '..', '..', 'packages', 'ui-native', 'fonts');
const to = join(app, 'public', 'fonts');
mkdirSync(to, { recursive: true });
for (const face of ['Regular', 'Medium', 'SemiBold', 'Bold', 'LICENSE']) {
  const file = face === 'LICENSE' ? 'LICENSE.txt' : `Inter-${face}.ttf`;
  copyFileSync(join(from, file), join(to, file));
}
