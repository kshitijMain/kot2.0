import { z } from 'zod';

const url = z.url({ protocol: /^(?:https?|postgres(?:ql)?)$/ });

/**
 * The self-hosted relay's settings, from the environment (P9-01, ADR-0024). Secrets come only from
 * here, never from the repository (SEC-002): see `infra/relay-host/relay-host.env.example`.
 */
const Env = z.object({
  /** The functions' login, `relay_edge` (never the owner): every request runs as it. */
  RELAY_DB_URL: url,
  /** The jobs' login, `relay_janitor`, for expiry and retention. Unset: pg_cron or nothing does. */
  RELAY_JOBS_DB_URL: url.optional(),
  /** This host's public address, e.g. `https://menu.mannat.in` (photos are linked from it). */
  RELAY_PUBLIC_URL: z.url({ protocol: /^https?$/ }).transform((value) => value.replace(/\/+$/, '')),
  /** The QR site's origins, comma-separated, allowed to call from a browser (CORS). */
  RELAY_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter((origin) => origin !== ''),
    ),
  /** Signs the local servers' line tokens; at least 32 random characters. Unset: no open line. */
  RELAY_JWT_SECRET: z.string().min(32).optional(),
  /** The public key the line's socket asks for, as Supabase's does; any random string. */
  RELAY_REALTIME_API_KEY: z.string().min(16).optional(),
  /** Where menu photos are kept. Unset: no photos on the QR menu. */
  RELAY_PHOTOS_DIR: z.string().min(1).optional(),
  RELAY_HOST: z.string().min(1).default('127.0.0.1'),
  RELAY_PORT: z.coerce.number().int().min(0).max(65_535).default(8787),
  RELAY_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
});

export interface HostConfig {
  readonly databaseUrl: string;
  readonly jobsDatabaseUrl: string | undefined;
  readonly publicUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly jwtSecret: string | undefined;
  readonly apiKey: string | undefined;
  readonly photosDir: string | undefined;
  readonly host: string;
  readonly port: number;
  readonly poolSize: number;
}

export function hostConfigFrom(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`The relay host's settings are not right: ${problems}`);
  }
  const value = parsed.data;
  return {
    databaseUrl: value.RELAY_DB_URL,
    jobsDatabaseUrl: value.RELAY_JOBS_DB_URL,
    publicUrl: value.RELAY_PUBLIC_URL,
    allowedOrigins: value.RELAY_ALLOWED_ORIGINS,
    jwtSecret: value.RELAY_JWT_SECRET,
    apiKey: value.RELAY_REALTIME_API_KEY,
    photosDir: value.RELAY_PHOTOS_DIR,
    host: value.RELAY_HOST,
    port: value.RELAY_PORT,
    poolSize: value.RELAY_POOL_SIZE,
  };
}
