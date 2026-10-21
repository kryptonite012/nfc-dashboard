# syntax=docker/dockerfile:1.7
# VaultLedger: single image that serves the API and the built web app on one origin.

ARG NODE_IMAGE=node:22.12.0-bookworm-slim

# ---- Install all dependencies and build ---------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY . .
RUN npm run build

# ---- Production dependencies for the API only ----------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev --workspace @vaultledger/api && npm cache clean --force

# ---- Runtime --------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# openssl for Prisma; DejaVu fonts so PDF exports can render non-Latin text.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates fonts-dejavu-core tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST_DIR=/app/apps/web/dist \
    PDF_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Applies pending migrations, then starts the server. For multi-instance deployments,
# run `npx prisma migrate deploy` as a separate release step instead (see docs/DEPLOYMENT.md).
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && exec node apps/api/dist/index.js"]
