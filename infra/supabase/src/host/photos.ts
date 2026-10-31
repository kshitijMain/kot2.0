import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { PhotoStorage } from '../http.js';

/** Where photos are served from, as Supabase Storage's public bucket address. */
export const PHOTO_PATH = '/storage/v1/object/public/menu-photos/';

/** The only paths the `server` function writes: `<tenant>/<photo>/<width>.webp` (P5-03c). */
const PHOTO_FILE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:160|480|960)\.webp$/;

/**
 * Menu photos on the relay host's own disk (P9-01, ADR-0024), in place of Supabase Storage. A
 * path never changes for a photo, so it is written once (to a temporary name, then renamed) and
 * served as immutable for a year. Only paths of the relay's own form are accepted, so nothing
 * outside the folder is ever read or written.
 */
export function diskPhotoStorage(directory: string, publicBase: string): PhotoStorage {
  const fileOf = (path: string) => {
    if (!PHOTO_FILE.test(path)) throw new Error(`Not a photo path: ${path}`);
    return join(directory, path);
  };
  return {
    publicBase,
    async put(path, bytes) {
      const file = fileOf(path);
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${String(process.pid)}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, file);
    },
    async remove(paths) {
      for (const path of paths) await rm(fileOf(path), { force: true });
    },
  };
}

/** Serves a photo from `directory` at its public address; false when the path is not a photo's. */
export function servePhoto(
  directory: string,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): boolean {
  const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith(PHOTO_PATH)) return false;
  const path = decodeURIComponent(url.pathname.slice(PHOTO_PATH.length));
  if (!PHOTO_FILE.test(path) || (incoming.method !== 'GET' && incoming.method !== 'HEAD')) {
    outgoing.writeHead(404).end();
    return true;
  }
  const file = join(directory, path);
  stat(file).then(
    (info) => {
      outgoing.writeHead(200, {
        'content-type': 'image/webp',
        'content-length': String(info.size),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      if (incoming.method === 'HEAD') outgoing.end();
      else createReadStream(file).pipe(outgoing);
    },
    () => {
      outgoing.writeHead(404).end();
    },
  );
  return true;
}
