# BrewDial API container image.
# Multi-stage: build workspace → extract self-contained prod install via
# `pnpm deploy` → minimal runtime. Runs non-root. Base pinned by digest.
#
# Layout in the final image:
#   /app       — @brewdial/api prod deploy (dist + prod node_modules)
#   /migrate   — @brewdial/db deploy incl. node-pg-migrate + SQL migrations
#                (used by the k8s migration initContainer; see deploy/oci/k3s/)

# node:22-alpine multi-arch manifest list digest (linux/arm64 pulled on the
# ARM runner). Pinned 2026-08-06.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

# Dependency layer: manifests only, so lockfile changes (not source edits)
# bust the cache. All workspace package.json files must be present for
# `pnpm install --frozen-lockfile` to validate the lockfile.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
COPY apps/miniapp/package.json apps/miniapp/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile \
      --filter @brewdial/api... \
      --filter @brewdial/db...

# Source layer.
COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/shared packages/shared

# Build TS → dist, then extract deployable trees.
# `--legacy` is REQUIRED: pnpm v10 refuses deploy from workspaces without
# inject-workspace-packages=true (measured 2026-08-06, pnpm 10.33.2).
# The legacy deploy output is self-contained — workspace deps are copied into
# .pnpm/ and the symlinks resolve inside the output directory.
RUN pnpm --filter @brewdial/shared --filter @brewdial/db --filter @brewdial/api build \
 && rm -rf /out/api /out/db \
 && pnpm deploy --legacy --filter @brewdial/api --prod /out/api \
 && pnpm deploy --legacy --filter @brewdial/db --dev /out/db

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app
COPY --from=build /out/api /app
COPY --from=build /out/db /migrate
COPY packages/db/migrations /migrate/migrations

ENV NODE_ENV=production
# node base image ships uid/gid 1000 as `node`.
USER node
EXPOSE 3020

# DATABASE_URL is required at boot (loadConfig throws without it) — supplied
# by the k8s Secret. SENTRY_DSN/GIT_SHA optional (ConfigMap placeholders).
CMD ["node", "/app/dist/server.js"]
