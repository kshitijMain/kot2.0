# infra/relay-host: the QR site and relay on a server of your own

The QR menu site (`apps/qr-menu`) and the QR relay (`infra/supabase`, run by its Node host) on one
Ubuntu server, for the QR pilot ([ADR-0024](../../docs/adr/0024-qr-pilot-self-hosted-relay.md)).
Many restaurants can share it. Built by P9-01.

```
Diner's phone ──HTTPS──> Caddy :443 ─┬─ /functions/v1/*   ─> relay host :8787 (Node) ─> PostgreSQL 16
                                     ├─ /realtime/v1/*    ─> relay host (each restaurant's open line)
                                     ├─ /storage/.../menu-photos/* ─> /var/lib/rp-relay/photos
                                     └─ everything else   ─> QR site :3100 (Next.js)
Restaurant PC ──HTTPS + one WebSocket, outbound only──┘
```

| File                     | What                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `setup-ubuntu.sh`        | Installs and configures everything on a fresh Ubuntu 24.04 (as root) |
| `Caddyfile`              | HTTPS and routing; the setup puts your address in                    |
| `relay-host.service`     | systemd unit for `infra/supabase/dist/relay-host.mjs`                |
| `qr-menu.service`        | systemd unit for the site                                            |
| `relay-host.env.example` | The relay host's settings (the setup writes the real file)           |
| `qr-menu.env.example`    | The site's one setting                                               |

The step-by-step for a person is [manual task 38](../../manual-tasks/38-qr-pilot-server.md).

## Logins

| Login                 | Used by                    | May                                           |
| --------------------- | -------------------------- | --------------------------------------------- |
| `postgres`            | `scripts/migrate.mjs` only | Everything (schema changes)                   |
| `relay_edge`          | The relay host's requests  | Take the diner's or writer's role per request |
| `relay_janitor`       | The relay host's jobs      | Run expiry and retention                      |
| `relay_control_plane` | `provision-restaurant.mjs` | Add restaurants and their credentials         |

Passwords and secrets are made by the setup and kept in `/etc/rp-relay/*.env` (root only).

## Day to day

```sh
systemctl status relay-host qr-menu caddy       # running?
curl -s http://127.0.0.1:8787/healthz           # {"ok":true,"restaurantsOnLine":1}
journalctl -u relay-host -f                     # the relay host's log
cd /opt/rp && git pull && sudo bash infra/relay-host/setup-ubuntu.sh menu.mannat.in   # update
```

Load:

- An idle restaurant costs one socket and a heartbeat every 25 seconds.
- An order costs one insert, one NOTIFY and one pickup.
- Diners' pages read the menu once and then only what changed.
- A 1 GB VM serves far more than a pilot needs.
