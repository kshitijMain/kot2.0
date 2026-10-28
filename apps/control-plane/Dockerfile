# The Vendor Control Plane's production image (ADR-0012, VCP-009): the API with the vendor web app
# served at / (CP_WEB_DIR), as a non-root user, with a health check on /v1/health. The same image
# applies the migrations and runs the admin CLI (docs/runbooks/control-plane-aws.md).
#
# Built from the repository root, by CI (SEC-013), never on a laptop for a real environment:
#   docker build -f apps/control-plane/Dockerfile -t rp-control-plane .
# Dockerfile.dockerignore beside this file keeps the context to what the image is built from: a
# new workspace package that the Control Plane or its web app depends on is added there too.
#
# No secret is built in (SEC-002): every value comes from the environment at run time.

# Node.js 24 LTS (.nvmrc) on Debian 13, by digest; Dependabot proposes new ones.
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS base
# OpenSSL for Prisma's schema engine (migrations), which links it, and the system's CA store.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
ENV CI=true
WORKDIR /repo
COPY . .
# The pnpm that package.json names (as in CI), then only the Control Plane, its web app and the
# workspace packages they use.
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile \
    --filter-prod "@rp/control-plane..." --filter-prod "@rp/control-plane-web..."
RUN pnpm --filter @rp/control-plane generate \
  && pnpm --filter-prod "@rp/control-plane..." --filter-prod "@rp/control-plane-web..." run build
# Run-time packages only, as real folders. Prisma's CLI comes with them (a peer of its client), at
# the lockfile's version, for `migrate deploy`.
RUN pnpm --filter @rp/control-plane deploy --prod \
    --config.inject-workspace-packages=true --config.node-linker=hoisted /out/control-plane \
  && cd /out/control-plane \
  && rm -rf src test pnpm-lock.yaml tsconfig.json tsconfig.build.json vitest.config.ts \
  && cp -R /repo/apps/control-plane-web/dist /out/web

FROM base AS service
# Amazon RDS's certificate authorities for ap-south-1. node-postgres treats sslmode=require as
# verify-full (the certificate and the host name), so Node needs them (NODE_EXTRA_CA_CERTS); the
# schema engine reads the system store. A changed file fails the build: check it and update the
# checksum (https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).
ADD --checksum=sha256:ca4a9dc14e06c3f84274eff3ffed0e5d4d3463141593e1159eb4a0904df6cd74 --chmod=0644 \
  https://truststore.pki.rds.amazonaws.com/ap-south-1/ap-south-1-bundle.pem /usr/local/share/rds/ap-south-1-bundle.pem
# One certificate a file for update-ca-certificates; then no package managers in the image.
RUN awk '/BEGIN CERTIFICATE/ { n++ } { print > ("/usr/local/share/ca-certificates/rds-ap-south-1-" n ".crt") }' \
    /usr/local/share/rds/ap-south-1-bundle.pem \
  && update-ca-certificates \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

ENV NODE_ENV=production \
  NODE_EXTRA_CA_CERTS=/usr/local/share/rds/ap-south-1-bundle.pem \
  HOST=0.0.0.0 \
  PORT=8090 \
  LOG_PRETTY=false \
  CP_WEB_DIR=/app/web \
  CHECKPOINT_DISABLE=1

WORKDIR /app
# Owned by root and read-only to the service's user: it cannot change its own code.
COPY --from=build /out/control-plane ./
COPY --from=build /out/web ./web

# The image's `node` user (not root); by number, so platforms can check it without /etc/passwd.
USER 1000:1000
EXPOSE 8090

# For `docker run` and Compose; ECS and the load balancer use their own checks of the same path.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8090) + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Migrations: node node_modules/prisma/build/index.js migrate deploy
# Admin CLI:  node dist/cli.js <command>
CMD ["node", "dist/main.js"]
