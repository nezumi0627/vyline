# Vyline — セルフホスト型 LINE クライアント
# マルチステージビルド: フロントビルド → バックエンド実行
# bun install は lockfile ベース（再現性確保）

# ── Stage 1: 依存インストール ──────────────────────────────
FROM oven/bun:1.2-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY Vyline/backend/package.json Vyline/backend/
COPY Vyline/apps/desktop/package.json Vyline/apps/desktop/
COPY Vyline/packages/types/package.json Vyline/packages/types/
COPY Vyline/packages/protocol/package.json Vyline/packages/protocol/
COPY Vyline/packages/line-types/package.json Vyline/packages/line-types/
COPY Vyline/packages/loose-types/package.json Vyline/packages/loose-types/
# workspace 全体を解決するため root で install（lockfile 使用）
RUN bun install --frozen-lockfile --ignore-scripts

# ── Stage 2: フロントエンドビルド ──────────────────────────
FROM oven/bun:1.2-alpine AS build
WORKDIR /app
# bun は workspace の依存を root の node_modules へ hoist するため、
# ワークスペース別の node_modules はコピー不要（存在しない）
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY Vyline ./Vyline
WORKDIR /app/Vyline/apps/desktop
RUN bun run build

# ── Stage 3: 実行 ───────────────────────────────────────────
FROM oven/bun:1.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV VYLINE_HOST=0.0.0.0
ENV VYLINE_DATA_DIR=/data

# ランタイムに必要なファイルのみコピー
COPY package.json bun.lock ./
COPY Vyline/backend/package.json Vyline/backend/
COPY Vyline/apps/desktop/package.json Vyline/apps/desktop/
COPY Vyline/packages/types/package.json Vyline/packages/types/
COPY Vyline/packages/protocol/package.json Vyline/packages/protocol/
COPY Vyline/packages/line-types/package.json Vyline/packages/line-types/
COPY Vyline/packages/loose-types/package.json Vyline/packages/loose-types/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/Vyline/apps/desktop/dist ./Vyline/apps/desktop/dist
COPY Vyline/backend/src ./Vyline/backend/src
COPY Vyline/packages/types/src ./Vyline/packages/types/src
COPY Vyline/packages/protocol/src ./Vyline/packages/protocol/src
COPY Vyline/packages/protocol/data ./Vyline/packages/protocol/data
COPY Vyline/packages/protocol/stack ./Vyline/packages/protocol/stack
COPY Vyline/packages/line-types/line_types.ts Vyline/packages/line-types/thrift.ts Vyline/packages/line-types/
COPY Vyline/packages/loose-types/mod.ts Vyline/packages/loose-types/

VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz >/dev/null 2>&1 || exit 1

CMD ["bun", "run", "Vyline/backend/src/index.ts"]
