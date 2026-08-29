# Vyline — Bun ベースの軽量ランタイムイメージ
# ビルド: docker build -t vyline .
# 実行:  docker run -p 3000:3000 -v ./data:/app/data vyline

ARG BUN_VERSION=1.4.0
ARG VYLINE_VERSION=dev
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock* ./
COPY Vyline/apps/desktop/package.json Vyline/apps/desktop/
COPY Vyline/backend/package.json Vyline/backend/
COPY Vyline/packages/types/package.json Vyline/packages/types/
COPY Vyline/packages/ios-backup/package.json Vyline/packages/ios-backup/
COPY Vyline/packages/protocol/package.json Vyline/packages/protocol/
COPY Vyline/packages/line-types/package.json Vyline/packages/line-types/
COPY Vyline/packages/loose-types/package.json Vyline/packages/loose-types/
COPY Vyline/packages/plugin/sdk/package.json Vyline/packages/plugin/sdk/
COPY Vyline/packages/themes/package.json Vyline/packages/themes/
RUN bun install --ignore-scripts

FROM deps AS prod-deps
RUN rm -rf node_modules Vyline/*/node_modules Vyline/*/*/node_modules \
  && bun install --production --ignore-scripts

ARG BUN_VERSION=1.4.0
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/Vyline/apps/desktop/node_modules ./Vyline/apps/desktop/node_modules
COPY --from=deps /app/Vyline/backend/node_modules ./Vyline/backend/node_modules
COPY --from=deps /app/Vyline/packages ./Vyline/packages
COPY . .
RUN bun run build

ARG BUN_VERSION=1.4.0
ARG VYLINE_VERSION=dev
FROM oven/bun:${BUN_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    VYLINE_VERSION=${VYLINE_VERSION} \
    VYLINE_HOST=0.0.0.0 \
    PORT=3000 \
    VYLINE_DATA_DIR=/app/data \
    VYLINE_STORAGE_DIR=/app/storage
LABEL org.opencontainers.image.title="Vyline" \
      org.opencontainers.image.source="https://github.com/tqmane/vyline" \
      org.opencontainers.image.version="${VYLINE_VERSION}"
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends gosu \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/Vyline/backend/node_modules ./Vyline/backend/node_modules
COPY --from=build /app/Vyline/packages ./Vyline/packages
COPY --from=build /app/openapi.yaml ./openapi.yaml
COPY --from=build /app/Vyline/backend/src ./Vyline/backend/src
COPY --from=build /app/Vyline/apps/desktop/dist ./Vyline/apps/desktop/dist
COPY docker-entrypoint.sh /usr/local/bin/vyline-entrypoint
RUN mkdir -p /app/data /app/storage \
  && chown -R bun:bun /app/data /app/storage \
  && chmod 0755 /usr/local/bin/vyline-entrypoint
EXPOSE 3000
VOLUME ["/app/data", "/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/healthz").then(function(r){process.exit(r.ok?0:1)},function(){process.exit(1)})'
ENTRYPOINT ["/usr/local/bin/vyline-entrypoint"]
CMD ["bun", "Vyline/backend/src/index.ts"]
