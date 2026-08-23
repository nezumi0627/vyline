# Vyline — Bun ベースの単一イメージ
# ビルド: docker build -t vyline .
# 実行:  docker run -p 3000:3000 -v ./data:/app/data vyline

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
COPY Vyline/apps/desktop/package.json Vyline/apps/desktop/
COPY Vyline/backend/package.json Vyline/backend/
COPY Vyline/packages/types/package.json Vyline/packages/types/
COPY Vyline/packages/protocol/package.json Vyline/packages/protocol/
COPY Vyline/packages/line-types/package.json Vyline/packages/line-types/
COPY Vyline/packages/loose-types/package.json Vyline/packages/loose-types/
COPY Vyline/packages/plugin/sdk/package.json Vyline/packages/plugin/sdk/
COPY Vyline/packages/themes/package.json Vyline/packages/themes/
RUN bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/Vyline/apps/desktop/node_modules ./Vyline/apps/desktop/node_modules
COPY --from=deps /app/Vyline/backend/node_modules ./Vyline/backend/node_modules
COPY --from=deps /app/Vyline/packages ./Vyline/packages
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production \
    VYLINE_HOST=0.0.0.0 \
    PORT=3000 \
    VYLINE_DATA_DIR=/app/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/Vyline/backend/node_modules ./Vyline/backend/node_modules
COPY --from=build /app/Vyline/packages ./Vyline/packages
COPY --from=build /app/openapi.yaml ./openapi.yaml
COPY --from=build /app/Vyline/backend/src ./Vyline/backend/src
COPY --from=build /app/Vyline/apps/desktop/dist ./Vyline/apps/desktop/dist
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/healthz").then(function(r){process.exit(r.ok?0:1)},function(){process.exit(1)})'
CMD ["bun", "Vyline/backend/src/index.ts"]
