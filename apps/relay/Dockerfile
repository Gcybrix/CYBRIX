# CYBRIX Relay — production image (Prompt 7 §22, §27)
# Build context = REPO ROOT (railway.json points here), so shared-types is available.
# Runtime has ZERO npm dependencies: tsc type-only imports are erased on emit.

# ---- build stage -----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /build

# minimal standalone install (relay devDeps: typescript/vitest/@types only)
COPY apps/relay/package.json apps/relay/tsconfig.json apps/relay/
COPY packages/shared-types/package.json packages/shared-types/
RUN cd apps/relay && npm install --no-audit --no-fund --ignore-scripts

COPY packages/shared-types/ packages/shared-types/
COPY apps/relay/src/ apps/relay/src/
RUN cd apps/relay && npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:20-alpine
# tini = correct PID1 signal handling (graceful shutdown); wget = healthcheck
RUN apk add --no-cache tini wget \
 && addgroup -S cybrix \
 && adduser -S cybrix -G cybrix

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=8080 \
    LOG_LEVEL=info

COPY --from=build /build/apps/relay/dist ./dist

# writable runtime state (mount a Railway Volume here to persist the offline queue)
RUN mkdir -p /app/data && chown -R cybrix:cybrix /app
USER cybrix

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/relay/src/index.js"]
