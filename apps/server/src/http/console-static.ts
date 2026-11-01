import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';

/**
 * Security headers for the console's pages (SEC-003 defence in depth): scripts, styles and
 * connections only from this server, no framing, no plugins, no referrer leaks.
 */
export const CONSOLE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Trusted Types (P8-03c1): no string reaches an HTML or script sink (innerHTML, eval, a
    // script's src), and no policy may be made to let one through. React never needs one.
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
};

/** Where Vite puts content-hashed files, as it appears in a file path on this platform. */
const ASSETS_FOLDER = `${sep}assets${sep}`;

/** Paths the console must never answer: the API and the real-time socket. */
function isServerPath(path: string): boolean {
  return path.startsWith('/api/') || path === '/api' || path.startsWith('/socket.io');
}

/** A missing `/assets/app-1a2b.js` is a 404, not the app shell (which would break as a script). */
function looksLikeFile(path: string): boolean {
  return (path.split('/').pop() ?? '').includes('.');
}

function setHeaders(response: Response, filePath: string): void {
  for (const [name, value] of Object.entries(CONSOLE_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  // Vite puts content-hashed files under /assets/: cache them for good; always revalidate the rest.
  response.setHeader(
    'cache-control',
    filePath.includes(ASSETS_FOLDER) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
}

/**
 * Serves the built web console (P0-14b) from `directory` on the server's own origin, so the
 * console, the API and the socket share one origin (no CORS) and one TLS certificate (P0-15).
 * Any other GET that wants HTML gets `index.html`, for the console's client-side routes.
 */
export function consoleMiddleware(directory: string): express.RequestHandler[] {
  const root = resolve(directory);
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`The console build is missing: ${index} not found`);
  }
  // No redirect from a folder (`/assets` to `/assets/`): its page would replace the CSP (P8-03c1).
  const files = express.static(root, {
    index: false,
    fallthrough: true,
    redirect: false,
    setHeaders,
  });
  const staticFiles: express.RequestHandler = (request, response, next) => {
    if (isServerPath(request.path)) {
      next();
      return;
    }
    files(request, response, next);
  };
  const spaFallback = (request: Request, response: Response, next: NextFunction): void => {
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      isServerPath(request.path) ||
      looksLikeFile(request.path) ||
      !request.accepts('html')
    ) {
      next();
      return;
    }
    setHeaders(response, index);
    response.sendFile(index);
  };
  return [staticFiles, spaFallback];
}

/** Where the PC serves the waiter app in a phone's browser (P9-28). */
export const PHONE_PATH = '/phone';

/** Where Expo puts the phone web app's content-hashed scripts. */
const PHONE_HASHED_FOLDER = `${sep}_expo${sep}static${sep}`;

/**
 * The phone web app's headers: the console's, with two differences. React Native Web writes the
 * app's styles at run time, which `style-src 'self'` would refuse (styles only: scripts stay this
 * server's own files, with no eval). And the page registers its service worker, for notifications,
 * through one Trusted Types policy that allows that single URL.
 */
export const PHONE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  ...CONSOLE_SECURITY_HEADERS,
  'content-security-policy': (CONSOLE_SECURITY_HEADERS['content-security-policy'] ?? '')
    .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
    // One policy, which lets through only the service worker's own URL (WORKER_POLICY).
    .replace("trusted-types 'none'", 'trusted-types rp-phone-worker'),
};

function setPhoneHeaders(response: Response, filePath: string): void {
  for (const [name, value] of Object.entries(PHONE_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  response.setHeader(
    'cache-control',
    filePath.includes(PHONE_HASHED_FOLDER) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
}

/**
 * Serves the waiter app built for the browser (`apps/waiter-app`, `expo export --platform web`)
 * at /phone/ on the server's own origin (P9-28): the same screens as the Android app, for iPhones
 * and any phone without the APK, on the same origin as the API and the socket. /phone answers
 * with /phone/, and any other page under it with the app's index.html. Mount before the console,
 * whose fallback would answer /phone with the console.
 */
export function phoneMiddleware(directory: string): express.RequestHandler {
  const root = resolve(directory);
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`The phone web app build is missing: ${index} not found`);
  }
  const files = express.static(root, {
    index: false,
    fallthrough: true,
    redirect: false,
    setHeaders: setPhoneHeaders,
  });
  return (request, response, next) => {
    const path = request.path;
    if (path !== PHONE_PATH && !path.startsWith(`${PHONE_PATH}/`)) {
      next();
      return;
    }
    if (path === PHONE_PATH) {
      // The app's files are relative to /phone/: the page must be opened with the slash.
      const query = request.originalUrl.slice(request.path.length);
      response.redirect(301, `${PHONE_PATH}/${query}`);
      return;
    }
    const inner = path.slice(PHONE_PATH.length);
    const sendIndex = () => {
      if (
        (request.method !== 'GET' && request.method !== 'HEAD') ||
        looksLikeFile(inner) ||
        !request.accepts('html')
      ) {
        response.status(404).end();
        return;
      }
      setPhoneHeaders(response, index);
      response.sendFile(index);
    };
    if (inner === '/') {
      sendIndex();
      return;
    }
    // express.static resolves the request's path: serve the files under /phone/ from the root.
    const original = request.url;
    request.url = original.slice(PHONE_PATH.length);
    files(request, response, () => {
      request.url = original;
      sendIndex();
    });
  };
}
